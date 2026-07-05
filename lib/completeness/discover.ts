import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { z } from "zod"

import { canonicalizeUrl, extractResearchEntities } from "../ai/deep-research.ts"
import { firecrawlSearch, type SearchResultSource } from "../ai/firecrawl.ts"
import {
  buildCategoryProbeQuery,
  makeTopicRelevanceFloor,
  wantedLongTail,
} from "./category-probes.ts"
import { classifySource } from "./classify.ts"
import { type CategoryId, type CompletenessProfile } from "./profile.ts"

/**
 * Discovery + classification for a completeness run. Deliberately separate
 * from lib/ai/deep-research.ts: that module bakes in intent classification
 * (news/buying/research) for chat-latency search, which is a different
 * feature (source-type coverage for an unattended batch job would bleed back
 * into intent-reranking scope if reused as-is). This is purpose-built:
 * expand -> round 1 search -> entity probes -> round 2 search -> dedupe ->
 * classify EVERY unique result (no consensus-based shortlist before
 * classifying — that was the bug in the original approach: popular/duplicate
 * sources would crowd out the one-off niche hit a classifier is meant to catch).
 */

const DISCOVERY_MODEL_ID = "qwen/qwen3-next-80b-a3b-instruct"
const MODEL_CALL_TIMEOUT_MS = 30_000
// Safety valve on total classification calls per run, not a relevance
// mechanism — at the query volumes this demo runs at, dedupe rarely
// approaches this. Real batch use would tune this against Firecrawl credit
// budget, not accuracy.
const MAX_SOURCES_PER_RUN = 80
const SEARCH_RETRY_ATTEMPTS = 2

const nim = createOpenAICompatible({
  name: "nim",
  baseURL: "https://integrate.api.nvidia.com/v1",
  headers: { Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY ?? ""}` },
})

// Domains Firecrawl can surface in search but reliably can't scrape content
// from (bot-blocked). These still count as wanted hits for a completeness
// audit — "here's a source you missed, flagged for manual review" — they're
// just not citable/extractable.
const NON_EXTRACTABLE_DOMAINS = new Set([
  "reddit.com",
  "quora.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "threads.com",
  "x.com",
  "twitter.com",
])

function isExtractable(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "")
    return ![...NON_EXTRACTABLE_DOMAINS].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    )
  } catch {
    return true
  }
}

function parseJsonObject(text: string) {
  const trimmed = text.trim()
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "")
  if (!jsonText) return undefined
  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    return undefined
  }
}

const QueryVariantsSchema = z.object({ variants: z.array(z.string()).min(1).max(6) })

const HEURISTIC_VARIANT_TEMPLATES = [
  (q: string) => q,
  (q: string) => `${q} suppliers`,
  (q: string) => `${q} industry`,
  (q: string) => `best ${q}`,
]

function heuristicVariants(query: string): string[] {
  const seen = new Set<string>()
  const variants: string[] = []
  for (const template of HEURISTIC_VARIANT_TEMPLATES) {
    const variant = template(query).trim()
    if (variant && !seen.has(variant.toLowerCase())) {
      seen.add(variant.toLowerCase())
      variants.push(variant)
    }
  }
  return variants
}

/** Query expansion ONLY — no intent/freshness classification, unlike deep-research.ts's planner. */
export async function expandQuery(
  query: string,
  variantCount: number
): Promise<string[]> {
  try {
    const result = await generateText({
      model: nim.chatModel(DISCOVERY_MODEL_ID),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0.4,
      instructions: [
        "You expand a single research topic into differently-phrased web search queries for a completeness audit.",
        `Return ONLY compact JSON shaped like {"variants": string[]}. Produce exactly ${variantCount} variants.`,
        "Vary phrasing to probe different angles: exact phrase, industry/trade framing, comparison framing, supplier/wholesale framing.",
        "Always include a variant close to the original query.",
        "Do not answer the question. Only produce query strings.",
      ].join("\n"),
      prompt: `Topic: ${query}`,
      providerOptions: { nim: { reasoningEffort: "low" } },
    })
    const parsed = QueryVariantsSchema.safeParse(parseJsonObject(result.text))
    if (parsed.success && parsed.data.variants.length > 0) {
      return parsed.data.variants
    }
  } catch (error) {
    console.warn("[discover] query expansion failed, using heuristic fallback", error)
  }
  return heuristicVariants(query)
}

/** Per-category guidance for the batched vocabulary call. */
const VOCAB_HINTS: Partial<Record<CategoryId, string>> = {
  forum: "words signalling forum/community discussion for this topic (e.g. 'owners', 'enthusiasts', 'home barista', 'subreddit')",
  trade_pub: "real industry/trade terms for this topic (e.g. 'specialty coffee association', 'roaster')",
  regional_press: "local-news signal phrasings for this topic (e.g. 'new cafe', 'opens location')",
}

const CategoryVocabSchema = z.record(z.string(), z.array(z.string()))

/**
 * ONE batched LLM call: topic-specific vocabulary for every wanted category at
 * once (not one call per category — that's the balloon we're avoiding). The
 * model proposes only KEYWORDS; the fixed template owns the operators, so it
 * can't emit a self-defeating dork. Any failure → {} and the templates run on
 * their generic operator scaffold alone.
 */
async function generateCategoryVocab(
  query: string,
  categories: CategoryId[]
): Promise<Partial<Record<CategoryId, string[]>>> {
  if (categories.length === 0) return {}
  try {
    const result = await generateText({
      model: nim.chatModel(DISCOVERY_MODEL_ID),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0.3,
      instructions: [
        "You suggest short web-search KEYWORDS to help find specific source types about a topic.",
        'Return ONLY compact JSON shaped like {"<category>": ["term", "term"]}, 2-3 short terms each.',
        "Terms are topic-specific vocabulary ONLY — no search operators, no punctuation, no 'site:'.",
      ].join("\n"),
      prompt: `Topic: ${query}\nCategories and what each should find:\n${categories
        .map((c) => `- ${c}: ${VOCAB_HINTS[c] ?? c}`)
        .join("\n")}`,
      providerOptions: { nim: { reasoningEffort: "low" } },
    })
    const parsed = CategoryVocabSchema.safeParse(parseJsonObject(result.text))
    if (!parsed.success) return {}
    const out: Partial<Record<CategoryId, string[]>> = {}
    for (const c of categories) {
      const terms = parsed.data[c]
      if (Array.isArray(terms)) {
        out[c] = terms.filter((t) => typeof t === "string" && t.trim()).slice(0, 3)
      }
    }
    return out
  } catch (error) {
    console.warn("[discover] category vocab generation failed, using bare templates", error)
    return {}
  }
}

/**
 * Category-targeted probes: one search per wanted long-tail category, run in
 * PARALLEL with round 1 (queries derive from the topic, not round-1 entities, so
 * zero added latency). Each result is topic-anchored and passed through a lexical
 * relevance floor so a right-shaped but off-topic page doesn't get counted.
 */
async function runCategoryProbes(
  query: string,
  categories: CategoryId[],
  onEvent?: (event: DiscoveryEvent) => void
): Promise<{ query: string; category: CategoryId; sources: SearchResultSource[] }[]> {
  if (categories.length === 0) return []
  const vocab = await generateCategoryVocab(query, categories)
  const isRelevant = makeTopicRelevanceFloor(query)
  return Promise.all(
    categories.map((category) => {
      const probeQuery = buildCategoryProbeQuery(query, category, vocab[category] ?? [])
      return safeSearch(probeQuery, 8).then((sources) => {
        const filtered = sources.filter((s) =>
          isRelevant({ title: s.title, description: s.description })
        )
        onEvent?.({ type: "probe", query: probeQuery, round: 1, sources: filtered })
        return { query: probeQuery, category, sources: filtered }
      })
    })
  )
}

function isTransientError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || /timed?\s?out|ECONNRESET|fetch failed/i.test(error.message))
  )
}

/** One isolated, retried search call. A single dead query must never sink the whole run. */
async function safeSearch(query: string, limit: number): Promise<SearchResultSource[]> {
  for (let attempt = 0; attempt < SEARCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const { sources } = await firecrawlSearch({
        query,
        limit,
        excludeDomains: [], // this feature WANTS community forums (Reddit/Quora), unlike chat search
        scrapeContent: false, // classification only needs title/url/description
      })
      return sources
    } catch (error) {
      if (!isTransientError(error) || attempt === SEARCH_RETRY_ATTEMPTS - 1) {
        console.warn(`[discover] search failed for "${query}", skipping`, error)
        return []
      }
      console.warn(`[discover] transient search error for "${query}", retrying`)
    }
  }
  return []
}

export type ClassifiedSource = {
  url: string
  title: string
  description: string
  foundVia: string[]
  category: CategoryId
  matches: boolean
  confidence: "high" | "low"
  justification: string
  extractable: boolean
  parseFailed: boolean
}

/** The per-source classification payload streamed to the UI as each one lands. */
export type ClassifiedSourceEvent = {
  url: string
  title: string
  foundVia: string[]
  category: CategoryId
  matches: boolean
  confidence: "high" | "low"
  justification: string
  extractable: boolean
  parseFailed: boolean
}

export type DiscoveryResult = {
  query: string
  queriesRun: string[]
  rawSourceCount: number
  classifiedSources: ClassifiedSource[]
}

/**
 * Progress events for streaming the pipeline's real work into the UI accordion.
 * The CLI ignores these; the streaming API route turns each into a tool-call
 * part the existing chain-of-thought renders live.
 */
export type DiscoveryEvent =
  | { type: "expand"; variants: string[] }
  | { type: "probe"; query: string; round: 1 | 2; sources: SearchResultSource[] }
  | { type: "entities"; entities: string[] }
  | { type: "classifyStart"; total: number }
  | {
      type: "classified"
      done: number
      total: number
      source: ClassifiedSourceEvent
    }

export async function discoverAndClassify({
  query,
  profile,
  variantCount = 4,
  entityCount = 5,
  concurrency = 5,
  onEvent,
}: {
  query: string
  profile: CompletenessProfile
  variantCount?: number
  entityCount?: number
  concurrency?: number
  onEvent?: (event: DiscoveryEvent) => void
}): Promise<DiscoveryResult> {
  // Round 1: expand + search all variants in parallel. Fire a probe event as
  // each search resolves so the accordion fills in live rather than all at once.
  const variants = await expandQuery(query, variantCount)
  onEvent?.({ type: "expand", variants })

  // Category-targeted probes fire in PARALLEL with round 1 — one extra search per
  // wanted long-tail category, shaped to surface exactly the source types the
  // generic round leaves thin. Gated on the wanted-set, so a run that wants none
  // does no extra work.
  const wantedCategories = wantedLongTail(profile)
  const categoryProbePromise = runCategoryProbes(query, wantedCategories, onEvent)

  const round1Lists = await Promise.all(
    variants.map((v) =>
      safeSearch(v, 10).then((sources) => {
        onEvent?.({ type: "probe", query: v, round: 1, sources })
        return sources
      })
    )
  )
  const round1Sources = round1Lists.flat()
  const categoryProbes = await categoryProbePromise

  // Round 2: pull named entities out of round-1 results, search each directly —
  // this is what surfaces the source that covers the specific product/entity
  // but never ranks for the generic topic query.
  const entities = await extractResearchEntities({
    currentDateContext: "",
    modelId: DISCOVERY_MODEL_ID,
    query,
    sources: round1Sources,
  })
  const boundedEntities = entities.slice(0, entityCount)
  if (boundedEntities.length) {
    onEvent?.({ type: "entities", entities: boundedEntities })
  }
  const round2Lists = boundedEntities.length
    ? await Promise.all(
        boundedEntities.map((e) =>
          safeSearch(e, 8).then((sources) => {
            onEvent?.({ type: "probe", query: e, round: 2, sources })
            return sources
          })
        )
      )
    : []
  const round2Sources = round2Lists.flat()

  // Dedupe by canonical URL — NO consensus-count ranking or truncation here.
  // Classification is what decides relevance now, not "how many lists found it."
  // We also track whether a source came from a category probe, because the cost
  // cap below must NOT evict the long-tail we deliberately hunted for.
  const categoryProbeQueries = new Set(categoryProbes.map((p) => p.query))
  const byCanonical = new Map<
    string,
    { source: SearchResultSource; foundVia: Set<string>; fromCategoryProbe: boolean }
  >()
  const allLists: [string, SearchResultSource[]][] = [
    ...variants.map((v, i): [string, SearchResultSource[]] => [v, round1Lists[i] ?? []]),
    ...boundedEntities.map((e, i): [string, SearchResultSource[]] => [e, round2Lists[i] ?? []]),
    ...categoryProbes.map((p): [string, SearchResultSource[]] => [p.query, p.sources]),
  ]
  for (const [via, sources] of allLists) {
    const isCategoryProbe = categoryProbeQueries.has(via)
    for (const source of sources) {
      const key = canonicalizeUrl(source.url)
      const existing = byCanonical.get(key)
      if (existing) {
        existing.foundVia.add(via)
        if (isCategoryProbe) existing.fromCategoryProbe = true
      } else {
        byCanonical.set(key, { source, foundVia: new Set([via]), fromCategoryProbe: isCategoryProbe })
      }
    }
  }

  // Apply the cost cap category-probe-first, so the generic/entity flood of SEO
  // winners can't evict the long-tail sources the probes were built to find.
  // Insertion order is preserved within each group (JS filter is stable).
  const values = [...byCanonical.values()]
  const unique = [
    ...values.filter((v) => v.fromCategoryProbe),
    ...values.filter((v) => !v.fromCategoryProbe),
  ].slice(0, MAX_SOURCES_PER_RUN)
  if (byCanonical.size > MAX_SOURCES_PER_RUN) {
    console.warn(
      `[discover] ${byCanonical.size} unique sources found, capping classification at ${MAX_SOURCES_PER_RUN} (category-probe sources kept first; cost safety valve, not a relevance cutoff)`
    )
  }

  // Classify every unique source, bounded concurrency.
  onEvent?.({ type: "classifyStart", total: unique.length })
  const classifiedSources: ClassifiedSource[] = new Array(unique.length)
  let cursor = 0
  let done = 0
  async function worker() {
    while (cursor < unique.length) {
      const index = cursor++
      const { source, foundVia } = unique[index]
      const result = await classifySource({
        source: { url: source.url, title: source.title, description: source.description },
        profile,
      })
      const classified: ClassifiedSource = {
        url: source.url,
        title: source.title,
        description: source.description,
        foundVia: [...foundVia],
        category: result.category,
        matches: result.matches,
        confidence: result.confidence,
        justification: result.justification,
        extractable: isExtractable(source.url),
        parseFailed: result.parseFailed,
      }
      classifiedSources[index] = classified
      done += 1
      onEvent?.({
        type: "classified",
        done,
        total: unique.length,
        source: {
          url: classified.url,
          title: classified.title,
          foundVia: classified.foundVia,
          category: classified.category,
          matches: classified.matches,
          confidence: classified.confidence,
          justification: classified.justification,
          extractable: classified.extractable,
          parseFailed: classified.parseFailed,
        },
      })
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, worker)
  )

  const categoryProbeSources = categoryProbes.reduce((n, p) => n + p.sources.length, 0)
  return {
    query,
    queriesRun: [...variants, ...boundedEntities, ...categoryProbes.map((p) => p.query)],
    rawSourceCount: round1Sources.length + round2Sources.length + categoryProbeSources,
    classifiedSources,
  }
}
