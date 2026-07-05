import { type CategoryId } from "./profile.ts"

/**
 * Depth/breadth control for the completeness audit. The pipeline is a
 * DETERMINISTIC loop (this file holds no I/O) — an effort preset only tunes how
 * wide it casts and how many rounds it's willing to dig, plus the hard ceilings
 * that bound worst-case cost. Deeper != more agentic: control flow stays fixed
 * code; the LLM only fills bounded slots. See the design notes on discover.ts.
 */

export type EffortConfig = {
  /** Round-1 query expansions (breadth). */
  variantCount: number
  /** Entities probed per depth round (breadth per round). */
  entityCountPerRound: number
  /** Hard round ceiling (round 1 = facets; rounds 2..maxRounds = depth). */
  maxRounds: number
  /** Stop after this many CONSECUTIVE rounds that add no new WANTED domains. */
  saturationK: number
  /** Results requested per search. */
  limit: number
  /** Deep-read the scarce wanted sources (scrape -> markdown) to harvest richer
   *  entities. Off for light presets; the scrape budget is capped by maxScrapes. */
  scrapeWanted: boolean
  /** Hard ceilings — the loop stops at whichever fires first (with saturation). */
  maxSearches: number
  maxScrapes: number
}

export type EffortPreset = "quick" | "standard" | "thorough" | "exhaustive"

/** "Make it 10x slower, I don't care" = exhaustive. Standard ~= today's behavior. */
export const EFFORT_PRESETS: Record<EffortPreset, EffortConfig> = {
  quick: {
    variantCount: 3, entityCountPerRound: 0, maxRounds: 1, saturationK: 1,
    limit: 10, scrapeWanted: false, maxSearches: 8, maxScrapes: 0,
  },
  standard: {
    variantCount: 4, entityCountPerRound: 5, maxRounds: 2, saturationK: 1,
    limit: 10, scrapeWanted: false, maxSearches: 20, maxScrapes: 0,
  },
  thorough: {
    variantCount: 6, entityCountPerRound: 6, maxRounds: 4, saturationK: 2,
    limit: 10, scrapeWanted: true, maxSearches: 45, maxScrapes: 15,
  },
  exhaustive: {
    variantCount: 8, entityCountPerRound: 8, maxRounds: 8, saturationK: 2,
    limit: 15, scrapeWanted: true, maxSearches: 100, maxScrapes: 40,
  },
}

export function resolveEffort(x?: EffortPreset | EffortConfig): EffortConfig {
  if (!x) return EFFORT_PRESETS.standard
  if (typeof x === "string") return EFFORT_PRESETS[x] ?? EFFORT_PRESETS.standard
  return x
}

/** UI-facing preset list: label + one-line "how deep / how slow" description. */
export const EFFORT_PRESET_META: { id: EffortPreset; label: string; description: string }[] = [
  { id: "quick", label: "Quick", description: "One pass — fastest, shallowest" },
  { id: "standard", label: "Standard", description: "Two rounds — balanced (default)" },
  { id: "thorough", label: "Thorough", description: "Digs deeper, reads pages for richer leads" },
  { id: "exhaustive", label: "Exhaustive", description: "Runs until saturated — for overnight batches" },
]

export function isEffortPreset(x: unknown): x is EffortPreset {
  return typeof x === "string" && x in EFFORT_PRESETS
}

export type StopReason = "saturated" | "ceiling"

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** Minimal shape the loop-control logic needs from a classified source. */
export type WantedLike = { url: string; matches: boolean; category: CategoryId }

/**
 * The domains of newly-classified WANTED sources not seen before — the ONLY
 * signal that drives saturation. Filtered/noise sources are invisible here on
 * purpose: completeness is about the wanted long tail drying up, not total
 * volume (which the retailer flood would keep high forever).
 */
export function newWantedDomains(classified: WantedLike[], seen: Set<string>): string[] {
  const fresh = new Set<string>()
  for (const c of classified) {
    if (!c.matches) continue
    const d = domainOf(c.url)
    if (d && !seen.has(d)) fresh.add(d)
  }
  return [...fresh]
}

/**
 * Ceiling check, run BEFORE a round's work: has the run hit a hard resource cap?
 * Saturation (the K-dry-rounds stop) is handled separately, AFTER a round.
 */
export function hitCeiling(
  cfg: EffortConfig,
  state: { round: number; searchCount: number }
): boolean {
  return state.round > cfg.maxRounds || state.searchCount >= cfg.maxSearches
}
