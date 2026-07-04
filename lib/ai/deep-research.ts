import { generateText } from "ai"
import { z } from "zod"

import type { SearchResultSource } from "./firecrawl.ts"
import type { ModelId } from "./models.ts"
import {
  getLanguageModel,
  getProviderOptions,
  MODEL_CALL_TIMEOUT_MS,
} from "./provider.ts"

/**
 * Deep Research is a bounded, deterministic-shaped pipeline: a planner call
 * turns one question into a fixed set of query variants, those variants run
 * once in parallel, and one closed-form ranking call judges the fixed result
 * it's handed. Nothing here reads its own output and decides to fetch again —
 * that's the deliberate line kept clear of Firecrawl's own `/agent` pattern.
 */

const DEEP_RESEARCH_FRESHNESS_POLICY = z.enum([
  "live",
  "veryFresh",
  "fresh",
  "normal",
  "cached",
])

const DeepResearchPlanSchema = z.object({
  queryVariants: z.array(z.string()).min(1).max(5),
  intentLens: z.enum(["news", "buying", "research", "factual"]),
  // .nullish() (not .optional()) because JSON has no `undefined` — models
  // asked for an optional field naturally emit `null` for "no value".
  excludeSourceTypes: z.array(z.string()).nullish(),
  freshnessPolicy: DEEP_RESEARCH_FRESHNESS_POLICY.nullish(),
})

export type DeepResearchPlan = z.infer<typeof DeepResearchPlanSchema>

function parseJsonObject(text: string) {
  const trimmed = text.trim()
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "")

  if (!jsonText) {
    return undefined
  }

  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    return undefined
  }
}

export async function planDeepResearch({
  currentDateContext,
  modelId,
  query,
}: {
  currentDateContext: string
  modelId: ModelId
  query: string
}): Promise<DeepResearchPlan> {
  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0.4,
      instructions: [
        "You plan a thorough web research pass for a single user question.",
        'Return ONLY compact JSON shaped like {"queryVariants": string[], "intentLens": "news" | "buying" | "research" | "factual", "excludeSourceTypes": string[] | undefined, "freshnessPolicy": "live" | "veryFresh" | "fresh" | "normal" | "cached" | undefined}.',
        "queryVariants: 3 to 5 differently-phrased web search queries that probe the topic from different angles (exact phrase, overview, comparison, latest news, a narrower facet). Always include a variant close to the original question.",
        "intentLens: classify the dominant intent — news (recency/events), buying (comparing/evaluating products or services), research (deep background/analysis), or factual (a single lookup fact).",
        'excludeSourceTypes: only set this if the user explicitly asked to exclude a kind of source (e.g. "no vendor blogs", "skip forums"). Use short labels like "vendor_blog", "forum", "press_release". Omit if the user did not ask for exclusions.',
        "Do not answer the question. Only produce the plan.",
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        `User question: ${query}`,
      ].join("\n"),
      providerOptions: getProviderOptions(modelId),
    })

    const parsed = DeepResearchPlanSchema.safeParse(
      parseJsonObject(result.text)
    )

    if (parsed.success) {
      return parsed.data
    }

    console.warn("[deep-research] plan output failed validation, falling back", {
      zodError: parsed.error.flatten(),
    })
  } catch (error) {
    console.warn("[deep-research] plan call failed, falling back", error)
  }

  // Deterministic fallback: even when the planner LLM fails, still fan out wide
  // with template-based variants (à la a heuristic query expander) so Deep
  // Research never collapses to a single generic search.
  return { queryVariants: heuristicQueryVariants(query), intentLens: "research" }
}

const HEURISTIC_VARIANT_TEMPLATES = [
  (q: string) => q,
  (q: string) => `${q} reviews`,
  (q: string) => `${q} comparison`,
  (q: string) => `best ${q}`,
  (q: string) => `${q} 2026`,
]

function heuristicQueryVariants(query: string): string[] {
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

const TRACKING_PARAM_PREFIXES = ["utm_"]
// srsltid: Shopify's per-search-session tracking param, appended to nearly
// every product/collection URL Firecrawl surfaces on Shopify storefronts —
// without stripping it, the same retailer page shows up as multiple "unique"
// sources depending on which query surfaced it.
const TRACKING_PARAM_NAMES = new Set(["gclid", "fbclid", "ref", "si", "srsltid"])

/** Merge-only normalization — never shown to the user, just used as a dedup key. */
export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
    const path = parsed.pathname.replace(/\/+$/, "") || "/"
    const keptParams = [...parsed.searchParams.entries()]
      .filter(
        ([key]) =>
          !TRACKING_PARAM_NAMES.has(key.toLowerCase()) &&
          !TRACKING_PARAM_PREFIXES.some((prefix) =>
            key.toLowerCase().startsWith(prefix)
          )
      )
      .sort(([a], [b]) => a.localeCompare(b))
    const query = keptParams.map(([key, value]) => `${key}=${value}`).join("&")

    return `${host}${path}${query ? `?${query}` : ""}`
  } catch {
    return url
  }
}

export type ConsensusSource = SearchResultSource & { consensusCount: number }

/**
 * Merges N parallel search-result lists by canonical URL, counting how many
 * lists independently surfaced each result — the "consensus" signal, a plain
 * tally instead of a formal rank-fusion formula.
 */
export function mergeSearchResultsByConsensus({
  resultLists,
}: {
  resultLists: SearchResultSource[][]
}): ConsensusSource[] {
  const byCanonical = new Map<
    string,
    {
      bestPosition: number
      consensusCount: number
      source: SearchResultSource
    }
  >()

  for (const list of resultLists) {
    list.forEach((source, position) => {
      const key = canonicalizeUrl(source.url)
      const existing = byCanonical.get(key)

      if (!existing) {
        byCanonical.set(key, { bestPosition: position, consensusCount: 1, source })
        return
      }

      existing.consensusCount += 1
      existing.bestPosition = Math.min(existing.bestPosition, position)

      if (source.description.length > existing.source.description.length) {
        existing.source = source
      }
    })
  }

  return [...byCanonical.values()]
    .sort((a, b) =>
      b.consensusCount !== a.consensusCount
        ? b.consensusCount - a.consensusCount
        : a.bestPosition - b.bestPosition
    )
    .map(({ consensusCount, source }) => ({ ...source, consensusCount }))
}

export function buildShortlist(
  merged: ConsensusSource[],
  limit = 20
): ConsensusSource[] {
  return merged.slice(0, limit)
}

const ResearchEntitiesSchema = z.object({
  entities: z.array(z.string()).max(6),
})

/**
 * Round 2 of the fan-out: read the round-1 results and pull out the specific
 * named entities (products, companies, people, tools) worth searching on their
 * own. Searching an entity directly is what surfaces the niche/underground
 * source that covers *the product* but never ranks for the generic topic query.
 * Still bounded and one-shot — it proposes search strings, it never navigates.
 */
export async function extractResearchEntities({
  currentDateContext,
  modelId,
  query,
  sources,
}: {
  currentDateContext: string
  modelId: ModelId
  query: string
  sources: SearchResultSource[]
}): Promise<string[]> {
  if (sources.length === 0) {
    return []
  }

  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0.3,
      instructions: [
        "You extract specific named entities to search next for deeper, more niche research coverage.",
        'Return ONLY compact JSON shaped like {"entities": string[]}.',
        "From the search results, pick 3 to 6 specific named entities — companies, products, people, or tools — that are central to the topic and worth searching individually to surface niche or specialized sources.",
        "Prefer specific proper names over generic phrases. Skip entities identical to the original question.",
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        `Research question: ${query}`,
        "",
        `Search results so far:\n\n${sources
          .slice(0, 24)
          .map((source, index) =>
            `[${index + 1}] ${source.title}\n${source.description}`.trim()
          )
          .join("\n\n")}`,
      ].join("\n"),
      providerOptions: getProviderOptions(modelId),
    })

    const parsed = ResearchEntitiesSchema.safeParse(parseJsonObject(result.text))

    if (parsed.success) {
      const seen = new Set(sources.map((source) => source.query))
      return parsed.data.entities
        .map((entity) => entity.trim())
        .filter((entity) => entity.length > 0 && !seen.has(entity))
    }
  } catch (error) {
    console.warn("[deep-research] entity extraction failed, skipping round 2", error)
  }

  return []
}

const RankedShortlistSchema = z.object({
  rankedUrls: z.array(z.string()),
  // .nullish() — same reason as DeepResearchPlanSchema above: models tend to
  // emit `null` rather than omit the key for an unused optional field.
  excludedUrls: z.array(z.string()).nullish(),
})

export type RankedShortlist = z.infer<typeof RankedShortlistSchema>

/** A fast NIM instruct model is plenty for a bounded listwise judgment over ~20
 *  candidates. A non-reasoning instruct model is used on purpose: it returns the
 *  required JSON reliably without spending its budget on thinking. gpt-oss-20b
 *  was the original pick but is currently down on NIM. */
const DEEP_RESEARCH_RANKING_MODEL_ID: ModelId = "qwen/qwen3-next-80b-a3b-instruct"

function formatShortlistForRanking(shortlist: ConsensusSource[]) {
  return shortlist
    .map((source, index) => {
      let domain = source.url
      try {
        domain = new URL(source.url).hostname
      } catch {
        // Keep the raw URL as a fallback label.
      }

      return [
        `[${index + 1}] ${source.title || source.url}`,
        `URL: ${source.url}`,
        `Domain: ${domain}`,
        `Seen in ${source.consensusCount} of the search variants`,
        `Excerpt: ${source.snippet || source.description}`,
      ].join("\n")
    })
    .join("\n\n---\n\n")
}

const INTENT_LENS_GUIDANCE: Record<DeepResearchPlan["intentLens"], string> = {
  buying: "prioritize sources that directly compare options, not single-product pages.",
  factual: "prioritize the single most directly authoritative source for the fact.",
  news: "prioritize freshness and direct event coverage.",
  research: "prioritize depth, credibility, and variety of angle over generic overviews.",
}

/**
 * The one closed-form judgment call in the pipeline: given an already-fetched,
 * fixed shortlist, decide keep/drop and final order. It can only reorder and
 * filter what it's handed — it never gets to ask for another search.
 */
export async function rankShortlist({
  currentDateContext,
  excludeSourceTypes,
  intentLens,
  query,
  shortlist,
}: {
  currentDateContext: string
  excludeSourceTypes?: string[] | null
  intentLens: DeepResearchPlan["intentLens"]
  query: string
  shortlist: ConsensusSource[]
}): Promise<RankedShortlist> {
  const identityFallback: RankedShortlist = {
    excludedUrls: [],
    rankedUrls: shortlist.map((source) => source.url),
  }

  if (shortlist.length === 0) {
    return identityFallback
  }

  try {
    const result = await generateText({
      model: getLanguageModel(DEEP_RESEARCH_RANKING_MODEL_ID),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0.2,
      instructions: [
        "You judge a shortlist of already-fetched web sources for one research question.",
        'Return ONLY compact JSON shaped like {"rankedUrls": string[], "excludedUrls": string[] | undefined}.',
        "rankedUrls: every URL from the shortlist worth keeping, ordered best-first.",
        `Rank for "${intentLens}" intent: ${INTENT_LENS_GUIDANCE[intentLens]}`,
        "Collapse near-duplicate sources (same story, same content, different domain) — keep only the strongest copy.",
        "Prefer a varied set of domains and angles over many similar sources saying the same thing.",
        excludeSourceTypes?.length
          ? `Exclude any source that looks like: ${excludeSourceTypes.join(", ")}. Put excluded URLs in excludedUrls, not rankedUrls.`
          : "Do not exclude anything unless it is clearly irrelevant.",
        "Never invent a URL that is not in the shortlist.",
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        `Research question: ${query}`,
        "",
        `Shortlist:\n\n${formatShortlistForRanking(shortlist)}`,
      ].join("\n"),
      providerOptions: getProviderOptions(DEEP_RESEARCH_RANKING_MODEL_ID),
    })

    const parsed = RankedShortlistSchema.safeParse(parseJsonObject(result.text))

    if (parsed.success && parsed.data.rankedUrls.length > 0) {
      return parsed.data
    }
  } catch {
    // Fall through to the identity fallback below.
  }

  return identityFallback
}

/** Applies a ranking to a fixed source list. Never lets exclusions empty the
 *  list out entirely — a real source beats an over-eager filter. */
export function applyRanking<T extends { url: string }>(
  sources: T[],
  ranking: RankedShortlist
): T[] {
  const excluded = new Set(ranking.excludedUrls ?? [])
  const orderIndex = new Map(
    ranking.rankedUrls.map((url, index) => [url, index] as const)
  )

  const kept = sources.filter((source) => !excluded.has(source.url))
  const candidates = kept.length > 0 ? kept : sources

  return [...candidates].sort((a, b) => {
    const aIndex = orderIndex.get(a.url) ?? Number.MAX_SAFE_INTEGER
    const bIndex = orderIndex.get(b.url) ?? Number.MAX_SAFE_INTEGER
    return aIndex - bIndex
  })
}
