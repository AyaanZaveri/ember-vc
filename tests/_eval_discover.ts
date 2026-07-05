/**
 * Harness adapter (external completeness-eval, not part of the product).
 * Runs Ember's REAL discovery pipeline (discoverAndClassify) as a black box and
 * prints the discovered source set as JSON on stdout. The eval relabels these
 * URLs with its own shared labeler, so Ember's classifier verdict is reported
 * but NOT used to decide "long-tail" — that keeps the cross-method comparison
 * fair. Run: node --env-file=.env tests/_eval_discover.ts "<query>"
 */
import { discoverAndClassify } from "../lib/completeness/discover.ts"
import { DEMO_PROFILE } from "../lib/completeness/profile.ts"

async function main() {
  const query = process.argv[2]
  if (!query) {
    console.error("usage: node --env-file=.env tests/_eval_discover.ts \"<query>\"")
    process.exit(1)
  }
  const started = Date.now()
  const result = await discoverAndClassify({ query, profile: DEMO_PROFILE })
  const out = {
    method: "ember",
    query,
    ms: Date.now() - started,
    queriesRun: result.queriesRun,
    rawSourceCount: result.rawSourceCount,
    sources: result.classifiedSources.map((s) => ({
      url: s.url,
      title: s.title,
      description: s.description,
      emberCategory: s.category,
      emberMatches: s.matches,
      foundVia: s.foundVia,
    })),
  }
  process.stdout.write(JSON.stringify(out))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
