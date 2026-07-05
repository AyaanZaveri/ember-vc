import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { discoverAndClassify } from "../lib/completeness/discover.ts"
import { DEMO_PROFILE } from "../lib/completeness/profile.ts"
import { buildCoverageReport, formatCoverageReportMarkdown } from "../lib/completeness/report.ts"

/**
 * The actual product surface: run unattended against a query, produce a
 * persisted completeness-audit artifact. Matches how the customer described
 * their workflow — "a few thousand queries a night... nobody is watching a
 * spinner" — so this is a script you run and check the output of later, not
 * a chat you sit in front of.
 *
 * Run: node --env-file=.env scripts/completeness-audit.ts "<query>"
 */

const OUTPUT_DIR = join(import.meta.dirname, "..", "runs")

async function main() {
  const query = process.argv.slice(2).join(" ").trim()
  if (!query) {
    console.error('Usage: node --env-file=.env scripts/completeness-audit.ts "<query>"')
    process.exit(1)
  }
  if (!process.env.FIRECRAWL_API_KEY || !process.env.NVIDIA_NIM_API_KEY) {
    console.error("Missing FIRECRAWL_API_KEY or NVIDIA_NIM_API_KEY.")
    process.exit(1)
  }

  console.log(`Running completeness audit for: "${query}"\n`)
  const startedAt = performance.now()

  const discovery = await discoverAndClassify({ query, profile: DEMO_PROFILE })
  const report = buildCoverageReport({
    query,
    queriesRun: discovery.queriesRun,
    profile: DEMO_PROFILE,
    classifiedSources: discovery.classifiedSources,
  })

  const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(`Done in ${durationSeconds}s. ${report.totalSourcesFound} unique sources, ${report.gaps.length} gap(s), ${report.thin.length} thin.\n`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
  const jsonPath = join(OUTPUT_DIR, `${slug}.json`)
  const mdPath = join(OUTPUT_DIR, `${slug}.md`)
  writeFileSync(jsonPath, JSON.stringify({ discovery, report }, null, 2))
  writeFileSync(mdPath, formatCoverageReportMarkdown(report))

  console.log(`Saved: ${jsonPath}`)
  console.log(`Saved: ${mdPath}`)
  console.log("")
  console.log(formatCoverageReportMarkdown(report))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
