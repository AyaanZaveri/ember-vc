import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { classifySource } from "../../lib/completeness/classify.ts"
import { FIXTURES } from "./fixtures.ts"
import { DEMO_PROFILE, type CategoryId } from "../../lib/completeness/profile.ts"

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results")

/**
 * Eval harness: run the classifier over every hand-labeled fixture and report
 * how often it agrees with ground truth. Two numbers matter:
 *   - category accuracy: did it pick the exact source type?
 *   - MATCH accuracy: did the derived keep/drop decision match the analyst?
 * Match accuracy is the headline — it's the business call, and it survives
 * category confusions that stay inside the same keep/drop bucket.
 *
 * Run: node --env-file=.env tests/classifier/eval.ts
 */

const CONCURRENCY = 5

type Row = {
  id: string
  expectedCategory: string
  predictedCategory: string
  categoryOk: boolean
  expectedMatch: boolean
  predictedMatch: boolean
  matchOk: boolean
  confidence: string
  parseFailed: boolean
  retries: number
}

async function runPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function run() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run)
  )
  return results
}

function pct(numerator: number, denominator: number) {
  return denominator === 0 ? "0.0" : ((numerator / denominator) * 100).toFixed(1)
}

async function main() {
  if (!process.env.NVIDIA_NIM_API_KEY) {
    console.error(
      "Missing NVIDIA_NIM_API_KEY. Run with: node --env-file=.env tests/classifier/eval.ts"
    )
    process.exit(1)
  }

  console.log(
    `Classifying ${FIXTURES.length} fixtures against the demo profile ` +
      `(include: ${DEMO_PROFILE.include.join(", ")})\n`
  )

  const rows = await runPool(
    FIXTURES,
    async (fixture): Promise<Row> => {
      const result = await classifySource({
        source: {
          url: fixture.url,
          title: fixture.title,
          description: fixture.description,
        },
        profile: DEMO_PROFILE,
      })

      return {
        id: fixture.id,
        expectedCategory: fixture.expectedCategory,
        predictedCategory: result.category,
        categoryOk: result.category === fixture.expectedCategory,
        expectedMatch: fixture.expectedMatch,
        predictedMatch: result.matches,
        matchOk: result.matches === fixture.expectedMatch,
        confidence: result.confidence,
        parseFailed: result.parseFailed,
        retries: result.retries,
      }
    },
    CONCURRENCY
  )

  const categoryHits = rows.filter((r) => r.categoryOk).length
  const matchHits = rows.filter((r) => r.matchOk).length
  const parseFails = rows.filter((r) => r.parseFailed).length

  const mismatches = rows.filter((r) => !r.matchOk || !r.categoryOk)

  if (mismatches.length > 0) {
    console.log("Disagreements:")
    for (const r of mismatches) {
      const matchNote = r.matchOk ? "" : "  [MATCH FLIP]"
      console.log(
        `  ${r.id}\n` +
          `    category: expected ${r.expectedCategory}, got ${r.predictedCategory} (conf ${r.confidence})\n` +
          `    match:    expected ${r.expectedMatch}, got ${r.predictedMatch}${matchNote}`
      )
    }
    console.log("")
  }

  console.log("─".repeat(48))
  console.log(
    `Category accuracy: ${categoryHits}/${rows.length} (${pct(categoryHits, rows.length)}%)`
  )
  console.log(
    `MATCH accuracy:    ${matchHits}/${rows.length} (${pct(matchHits, rows.length)}%)   <- the decision that matters`
  )
  if (parseFails > 0) {
    console.log(`Parse failures:    ${parseFails}/${rows.length}`)
  }
  console.log("─".repeat(48))

  // Per-category match accuracy — this is what the chart actually plots. It
  // shows the classifier doesn't just get an overall number right, but holds
  // up specifically on the mainstream_press vs regional_press/niche_forum
  // distinction the whole pitch rests on.
  const categoryIds = Array.from(
    new Set(rows.map((r) => r.expectedCategory))
  ) as CategoryId[]
  const perCategory = categoryIds
    .map((category) => {
      const inCategory = rows.filter((r) => r.expectedCategory === category)
      return {
        category,
        total: inCategory.length,
        matchHits: inCategory.filter((r) => r.matchOk).length,
        categoryHits: inCategory.filter((r) => r.categoryOk).length,
      }
    })
    .sort((a, b) => a.category.localeCompare(b.category))

  const generatedAt = new Date().toISOString()
  const runId = `run-${generatedAt.replace(/[:.]/g, "-")}`

  const record = {
    runId,
    generatedAt,
    fixtureCount: rows.length,
    profileInclude: DEMO_PROFILE.include,
    summary: {
      categoryAccuracy: categoryHits / rows.length,
      matchAccuracy: matchHits / rows.length,
      parseFailures: parseFails,
    },
    perCategory,
    rows,
  }

  mkdirSync(RESULTS_DIR, { recursive: true })
  const outPath = join(RESULTS_DIR, `${runId}.json`)
  writeFileSync(outPath, JSON.stringify(record, null, 2))
  const latestPath = join(RESULTS_DIR, "latest.json")
  writeFileSync(latestPath, JSON.stringify(record, null, 2))
  console.log(`\nSaved: ${outPath}`)
  console.log(`Saved: ${latestPath}  (always the most recent run)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
