import type { ClassifiedSource } from "./discover.ts"
import type { CategoryId, CompletenessProfile } from "./profile.ts"

/**
 * The gap report is the actual deliverable — deterministic aggregation over
 * the classifier's output, not a model call. "gaps" answers the customer's
 * literal complaint directly: which wanted source types came back empty.
 * "thin" catches the near-miss the customer would still complain about: a
 * category isn't empty, but it's suspiciously underrepresented next to the
 * unwanted noise — one token result to check a box, not real coverage.
 */

const THIN_THRESHOLD_RATIO = 0.34 // a wanted category with <34% of the run's average count is "thin"

export type CategoryBreakdown = {
  category: CategoryId
  wanted: boolean
  count: number
  sources: {
    url: string
    title: string
    confidence: "high" | "low"
    extractable: boolean
    justification: string
  }[]
}

export type CoverageReport = {
  query: string
  queriesRun: string[]
  profileInclude: CategoryId[]
  totalSourcesFound: number
  droppedCount: number
  byCategory: CategoryBreakdown[]
  gaps: CategoryId[]
  thin: CategoryId[]
}

export function buildCoverageReport({
  query,
  queriesRun,
  profile,
  classifiedSources,
}: {
  query: string
  queriesRun: string[]
  profile: CompletenessProfile
  classifiedSources: ClassifiedSource[]
}): CoverageReport {
  const byCategory: CategoryBreakdown[] = profile.categories.map(({ id }) => {
    const inCategory = classifiedSources.filter((s) => s.category === id)
    return {
      category: id,
      wanted: profile.include.includes(id),
      count: inCategory.length,
      sources: inCategory.map((s) => ({
        url: s.url,
        title: s.title,
        confidence: s.confidence,
        extractable: s.extractable,
        justification: s.justification,
      })),
    }
  })

  const wantedCounts = byCategory.filter((c) => c.wanted).map((c) => c.count)
  const avgWantedCount =
    wantedCounts.length > 0
      ? wantedCounts.reduce((sum, n) => sum + n, 0) / wantedCounts.length
      : 0

  const gaps = byCategory.filter((c) => c.wanted && c.count === 0).map((c) => c.category)
  const thin = byCategory
    .filter(
      (c) =>
        c.wanted &&
        c.count > 0 &&
        avgWantedCount > 0 &&
        c.count / avgWantedCount < THIN_THRESHOLD_RATIO
    )
    .map((c) => c.category)

  const droppedCount = classifiedSources.filter((s) => !s.matches).length

  return {
    query,
    queriesRun,
    profileInclude: profile.include,
    totalSourcesFound: classifiedSources.length,
    droppedCount,
    byCategory,
    gaps,
    thin,
  }
}

/** Human-readable rendering for a CLI/file deliverable. */
export function formatCoverageReportMarkdown(report: CoverageReport): string {
  const lines: string[] = []
  lines.push(`# Completeness Audit: "${report.query}"`)
  lines.push("")
  lines.push(
    `Ran ${report.queriesRun.length} search variants/entity probes, found ${report.totalSourcesFound} unique sources, ` +
      `filtered out ${report.droppedCount} not matching this client's profile.`
  )
  lines.push("")

  if (report.gaps.length > 0) {
    lines.push(`## ⚠ Gaps — wanted categories with ZERO results`)
    for (const category of report.gaps) {
      lines.push(`- **${category}**`)
    }
    lines.push("")
  } else {
    lines.push(`## Gaps: none — every wanted category has at least one result.`)
    lines.push("")
  }

  if (report.thin.length > 0) {
    lines.push(`## Thin coverage — wanted categories with suspiciously few results`)
    for (const category of report.thin) {
      const breakdown = report.byCategory.find((c) => c.category === category)
      lines.push(`- **${category}** (${breakdown?.count ?? 0} found)`)
    }
    lines.push("")
  }

  lines.push(`## Full breakdown`)
  for (const c of report.byCategory) {
    if (c.count === 0) continue
    lines.push(`### ${c.category} ${c.wanted ? "(wanted)" : "(not wanted — filtered)"} — ${c.count}`)
    for (const s of c.sources) {
      const flags = [
        s.confidence === "low" ? "low-confidence" : null,
        !s.extractable ? "not extractable, flagged for manual review" : null,
      ].filter(Boolean)
      lines.push(`- [${s.title}](${s.url})${flags.length ? ` _(${flags.join(", ")})_` : ""}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
