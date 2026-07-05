import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { z } from "zod"

import { canonicalizeUrl, extractResearchEntities } from "../ai/deep-research.ts"
import { firecrawlScrapeSource, firecrawlSearch, type SearchResultSource } from "../ai/firecrawl.ts"
import {
  resolveEffort,
  newWantedDomains,
  hitCeiling,
  type EffortConfig,
  type EffortPreset,
  type StopReason,
} from "./effort.ts"
import {
  buildCategoryProbeQuery,
  makeTopicRelevanceFloor,
  wantedLongTail,
} from "./category-probes.ts"
import { classifySource } from "./classify.ts"
import { COMPLETENESS_MODEL_ID } from "./model.ts"
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

// See model.ts for the latency test that picked this and how to override it.
const DISCOVERY_MODEL_ID = COMPLETENESS_MODEL_ID
const MODEL_CALL_TIMEOUT_MS = 30_000
// Per-run cost is now bounded by the effort config's hard ceilings
// (maxSearches / maxScrapes / maxRounds), not a fixed source cap.
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
  /** Why the depth loop stopped — the smart stop or the hard backstop. */
  stopReason: StopReason
  roundsRun: number
  searchCount: number
  scrapeCount: number
}

/**
 * Progress events for streaming the pipeline's real work into the UI accordion.
 * The CLI ignores these; the streaming API route turns each into a tool-call
 * part the existing chain-of-thought renders live.
 */
export type DiscoveryEvent =
  | { type: "expand"; variants: string[] }
  | { type: "probe"; query: string; round: number; sources: SearchResultSource[] }
  | { type: "entities"; entities: string[]; round: number }
  | { type: "reading"; round: number; count: number }
  | { type: "dry"; round: number; reason: "no-new-entities" | "no-new-wanted"; dryRounds: number; saturationK: number }
  | { type: "classifyStart"; total: number }
  | {
      type: "classified"
      done: number
      total: number
      round: number
      source: ClassifiedSourceEvent
    }

export async function discoverAndClassify({
  query,
  profile,
  effort,
  concurrency = 5,
  onEvent,
}: {
  query: string
  profile: CompletenessProfile
  effort?: EffortPreset | EffortConfig
  concurrency?: number
  onEvent?: (event: DiscoveryEvent) => void
}): Promise<DiscoveryResult> {
  const cfg = resolveEffort(effort)
  let searchCount = 0
  let scrapeCount = 0
  let classifyDone = 0

  // Shared pools, filled round by round. Classification happens PER ROUND (not
  // once at the end) so each depth round can harvest its next search terms from
  // the WANTED sources found so far — gold breeds gold.
  const byCanonical = new Map<
    string,
    { source: SearchResultSource; foundVia: Set<string>; fromCategoryProbe: boolean }
  >()
  const classifiedByUrl = new Map<string, ClassifiedSource>()
  const seenWantedDomains = new Set<string>()
  const probedEntities = new Set<string>()
  const scrapedUrls = new Set<string>()
  // Persist scraped markdown across rounds. Without this, a source read in an
  // earlier round falls back to its thin snippet in later rounds (the deep read
  // is thrown away), so depth stalls after one real layer.
  const scrapedContent = new Map<string, string>()
  const queriesRun: string[] = []

  /** Register a labelled list; return only the sources not seen before. */
  const absorb = (via: string, isCat: boolean, sources: SearchResultSource[]): SearchResultSource[] => {
    const fresh: SearchResultSource[] = []
    for (const source of sources) {
      const key = canonicalizeUrl(source.url)
      const existing = byCanonical.get(key)
      if (existing) {
        existing.foundVia.add(via)
        if (isCat) existing.fromCategoryProbe = true
      } else {
        byCanonical.set(key, { source, foundVia: new Set([via]), fromCategoryProbe: isCat })
        fresh.push(source)
      }
    }
    return fresh
  }

  /** Classify a batch of NEW sources (bounded concurrency); store + stream live. */
  const classifyBatch = async (sources: SearchResultSource[], round: number): Promise<ClassifiedSource[]> => {
    if (sources.length === 0) return []
    // Re-emit with the cumulative discovered count so the UI's total grows across rounds.
    onEvent?.({ type: "classifyStart", total: byCanonical.size })
    const out: ClassifiedSource[] = []
    let cursor = 0
    const worker = async () => {
      while (cursor < sources.length) {
        const s = sources[cursor++]
        const key = canonicalizeUrl(s.url)
        const foundVia = byCanonical.get(key)?.foundVia ?? new Set<string>([s.url])
        const result = await classifySource({
          source: { url: s.url, title: s.title, description: s.description },
          profile,
        })
        const classified: ClassifiedSource = {
          url: s.url,
          title: s.title,
          description: s.description,
          foundVia: [...foundVia],
          category: result.category,
          matches: result.matches,
          confidence: result.confidence,
          justification: result.justification,
          extractable: isExtractable(s.url),
          parseFailed: result.parseFailed,
        }
        classifiedByUrl.set(key, classified)
        out.push(classified)
        classifyDone += 1
        onEvent?.({
          type: "classified",
          done: classifyDone,
          total: byCanonical.size,
          round,
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
    await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker))
    return out
  }

  // --- Round 1: facet probes + category/operator probes (breadth) ---
  const variants = await expandQuery(query, cfg.variantCount)
  onEvent?.({ type: "expand", variants })

  const wantedCategories = wantedLongTail(profile)
  const categoryProbePromise = runCategoryProbes(query, wantedCategories, onEvent)

  const round1Lists = await Promise.all(
    variants.map((v) => {
      searchCount++
      return safeSearch(v, cfg.limit).then((sources) => {
        onEvent?.({ type: "probe", query: v, round: 1, sources })
        return sources
      })
    })
  )
  const categoryProbes = await categoryProbePromise
  searchCount += categoryProbes.length

  const round1Fresh: SearchResultSource[] = []
  variants.forEach((v, i) => {
    queriesRun.push(v)
    round1Fresh.push(...absorb(v, false, round1Lists[i] ?? []))
  })
  categoryProbes.forEach((p) => {
    queriesRun.push(p.query)
    round1Fresh.push(...absorb(p.query, true, p.sources))
  })
  const round1Classified = await classifyBatch(round1Fresh, 1)
  for (const d of newWantedDomains(round1Classified, seenWantedDomains)) seenWantedDomains.add(d)

  // --- Depth rounds 2..maxRounds ---
  let dryRounds = 0
  let stopReason: StopReason = "ceiling"
  let roundsRun = 1
  for (let round = 2; round <= cfg.maxRounds; round++) {
    if (cfg.entityCountPerRound === 0) break
    if (hitCeiling(cfg, { round, searchCount })) {
      stopReason = "ceiling"
      break
    }

    // Harvest next-round entities from WANTED sources first; fall back to the
    // broader pool only if we haven't found enough wanted sources yet.
    const allClassified = [...classifiedByUrl.values()]
    const wantedSources = allClassified.filter((c) => c.matches)
    const harvestFrom = wantedSources.length >= 2 ? wantedSources : allClassified

    // Deep mode: scrape wanted sources to markdown so the extractor reads full
    // text, not thin snippets. Spread the budget across rounds (so later layers
    // still get fresh reads) and NEVER re-scrape a page we've already read — the
    // bug that used to blow the whole budget in the first depth round.
    const perRoundScrapeCap = Math.max(4, Math.ceil(cfg.maxScrapes / Math.max(1, cfg.maxRounds - 1)))
    let scrapedThisRound = 0
    const harvestSources: SearchResultSource[] = []
    for (const c of harvestFrom) {
      let description = c.description
      const canScrape =
        cfg.scrapeWanted &&
        c.matches &&
        !scrapedUrls.has(c.url) &&
        scrapeCount < cfg.maxScrapes &&
        scrapedThisRound < perRoundScrapeCap
      if (scrapedContent.has(c.url)) {
        // Read in an earlier round — reuse the full text, don't re-scrape.
        description = scrapedContent.get(c.url)!
      } else if (canScrape) {
        scrapeCount++
        scrapedThisRound++
        scrapedUrls.add(c.url)
        try {
          const scraped = await firecrawlScrapeSource({
            source: { url: c.url, title: c.title, description: c.description, snippet: c.description, query },
          })
          const md = (scraped as { markdown?: string }).markdown
          if (md) {
            description = md.slice(0, 4000)
            scrapedContent.set(c.url, description)
          }
        } catch {
          // scrape failed — fall back to the snippet, no crash
        }
      }
      harvestSources.push({ url: c.url, title: c.title, description, snippet: c.description, query })
    }
    // Surface the deep-read so the depth loop is visible in the UI (the signature
    // Thorough/Exhaustive behavior — reading wanted sources for fresh leads).
    if (scrapedThisRound > 0) {
      onEvent?.({ type: "reading", round, count: scrapedThisRound })
    }

    const entities = (
      await extractResearchEntities({
        currentDateContext: "",
        modelId: DISCOVERY_MODEL_ID,
        query,
        sources: harvestSources,
      })
    )
      .filter((e) => !probedEntities.has(e.toLowerCase()))
      .slice(0, cfg.entityCountPerRound)

    if (entities.length === 0) {
      dryRounds++
      onEvent?.({ type: "dry", round, reason: "no-new-entities", dryRounds, saturationK: cfg.saturationK })
      if (dryRounds >= cfg.saturationK) {
        stopReason = "saturated"
        break
      }
      continue
    }
    entities.forEach((e) => probedEntities.add(e.toLowerCase()))
    onEvent?.({ type: "entities", entities, round })

    const entityLists = await Promise.all(
      entities.map((e) => {
        if (searchCount >= cfg.maxSearches) return Promise.resolve([] as SearchResultSource[])
        searchCount++
        return safeSearch(e, Math.max(6, cfg.limit - 2)).then((sources) => {
          onEvent?.({ type: "probe", query: e, round, sources })
          return sources
        })
      })
    )
    const roundFresh: SearchResultSource[] = []
    entities.forEach((e, i) => {
      queriesRun.push(e)
      roundFresh.push(...absorb(e, false, entityLists[i] ?? []))
    })
    const roundClassified = await classifyBatch(roundFresh, round)
    roundsRun = round

    const fresh = newWantedDomains(roundClassified, seenWantedDomains)
    if (fresh.length === 0) {
      dryRounds++
      onEvent?.({ type: "dry", round, reason: "no-new-wanted", dryRounds, saturationK: cfg.saturationK })
    } else {
      dryRounds = 0
      for (const d of fresh) seenWantedDomains.add(d)
    }
    if (dryRounds >= cfg.saturationK) {
      stopReason = "saturated"
      break
    }
  }

  return {
    query,
    queriesRun,
    rawSourceCount: byCanonical.size,
    classifiedSources: [...classifiedByUrl.values()],
    stopReason,
    roundsRun,
    searchCount,
    scrapeCount,
  }
}
