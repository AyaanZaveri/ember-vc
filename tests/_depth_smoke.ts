/**
 * Credit-frugal smoke test of the depth loop. Runs the STANDARD preset (no
 * scrapes, ~12 searches) once and prints the run metadata. Not a unit test —
 * it hits Firecrawl + NIM. Run: node --env-file=.env tests/_depth_smoke.ts "<query>"
 */
import { discoverAndClassify } from "../lib/completeness/discover.ts"
import { DEMO_PROFILE } from "../lib/completeness/profile.ts"

async function main() {
  const query = process.argv[2] ?? "best drip coffee maker"
  // Minimal scrape-path check: scrapeWanted on, but at most 2 scrape credits.
  const effort =
    process.argv[3] === "scrapetest"
      ? {
          // Frugal multi-round check: budget of 4 scrapes should SPREAD across
          // rounds (~2/round), not blow in round 1.
          variantCount: 3, entityCountPerRound: 3, maxRounds: 3, saturationK: 2,
          limit: 10, scrapeWanted: true, maxSearches: 14, maxScrapes: 4,
        }
      : ("standard" as const)
  const started = Date.now()
  const r = await discoverAndClassify({ query, profile: DEMO_PROFILE, effort })
  const wanted = r.classifiedSources.filter((s) => s.matches)
  console.log(JSON.stringify({
    query,
    seconds: Math.round((Date.now() - started) / 1000),
    stopReason: r.stopReason,
    roundsRun: r.roundsRun,
    searchCount: r.searchCount,
    scrapeCount: r.scrapeCount,
    classified: r.classifiedSources.length,
    wanted: wanted.length,
    wantedByCategory: wanted.reduce<Record<string, number>>((acc, s) => {
      acc[s.category] = (acc[s.category] ?? 0) + 1
      return acc
    }, {}),
  }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
