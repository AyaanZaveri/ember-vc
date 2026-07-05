/**
 * Offline scorer. Reads raw/<slug>.json (URLs from every method — no API calls),
 * RE-LABELS every URL with the current shared labeler (so improving the labeler
 * never costs credits), loads the ground-truth long-tail set, and computes the
 * metrics. Writes labeled/<slug>.json + scores/<slug>.json.
 *
 * Metrics (all under the ONE shared labeler):
 *   - longTailCount / total / longTailFraction  (size-robust; the headline)
 *   - categoryCoverage: how many of the 4 wanted long-tail categories appear
 *   - categoryDistribution
 *   - gtRecall: |method_longtail ∩ GT| / |GT|  (secondary; GT is incomplete)
 *   - emberAgreement (ember only): does Ember's own classifier's keep/drop match
 *     the shared labeler's long-tail call, on Ember's own output
 *
 * Usage: bun runners/score.ts <slug>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalUrl } from "../lib/normalize.ts"
import { labelUrl, isLongTail, isExtractable, LONG_TAIL, type Category } from "../lib/labeler.ts"

// Derived from this file's location (runners/ -> completeness-eval/).
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..")

type Labeled = {
  url: string; canonical: string; title: string; category: Category
  signal: string; longTail: boolean; extractable: boolean; inGT: boolean
  emberCategory?: string; emberMatches?: boolean
}

function loadGT(slug: string): { urls: Set<string>; allowlist: Record<string, Category> } {
  const p = join(OUT, "topics", `${slug}.gt.json`)
  if (!existsSync(p)) return { urls: new Set(), allowlist: {} }
  const gt = JSON.parse(readFileSync(p, "utf8")) as {
    longTailUrls: string[]; domainCategories?: Record<string, Category>
  }
  return {
    urls: new Set(gt.longTailUrls.map(canonicalUrl)),
    allowlist: gt.domainCategories ?? {},
  }
}

function main() {
  const slug = process.argv[2]
  if (!slug) { console.error("usage: bun score.ts <slug>"); process.exit(1) }
  const raw = JSON.parse(readFileSync(join(OUT, "raw", `${slug}.json`), "utf8"))
  const { urls: gt, allowlist } = loadGT(slug)

  const labeledOut: Record<string, Labeled[]> = {}
  const scores: Record<string, any> = {}

  for (const [method, v] of Object.entries<any>(raw.results)) {
    const seen = new Map<string, Labeled>()
    for (const s of v.sources as any[]) {
      const canonical = canonicalUrl(s.url)
      if (seen.has(canonical)) continue
      const { category, signal } = labelUrl(s.url, allowlist)
      seen.set(canonical, {
        url: s.url, canonical, title: s.title ?? "", category, signal,
        longTail: isLongTail(category), extractable: isExtractable(s.url), inGT: gt.has(canonical),
        emberCategory: s.emberCategory, emberMatches: s.emberMatches,
      })
    }
    const items = [...seen.values()]
    labeledOut[method] = items

    const longTail = items.filter((i) => i.longTail)
    // Headline metric = distinct long-tail SOURCES (domains), not URLs: a method
    // shouldn't look more complete by returning two pages of the same outlet.
    const dom = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u } }
    const longTailDomains = new Set(longTail.map((i) => dom(i.url)))
    // Extractable long-tail = the sources you can actually scrape + cite in a
    // report (reddit/quora/youtube etc. excluded). The "usable" completeness number.
    const longTailExtractable = longTail.filter((i) => i.extractable)
    const longTailExtractableDomains = new Set(longTailExtractable.map((i) => dom(i.url)))
    const totalDomains = new Set(items.map((i) => dom(i.url)))
    const dist: Record<string, number> = {}
    for (const i of items) dist[i.category] = (dist[i.category] ?? 0) + 1
    const coveredCats = new Set(longTail.map((i) => i.category))
    const gtHits = items.filter((i) => i.inGT).length

    // Ember-classifier vs shared-labeler agreement (only where ember labeled).
    let emberAgree: number | null = null
    const withEmber = items.filter((i) => i.emberMatches != null)
    if (withEmber.length) {
      const agree = withEmber.filter((i) => i.emberMatches === i.longTail).length
      emberAgree = agree / withEmber.length
    }

    scores[method] = {
      total: items.length,
      totalDomains: totalDomains.size,
      longTailCount: longTail.length,
      longTailDomains: longTailDomains.size,
      longTailDomainList: [...longTailDomains].sort(),
      longTailExtractableDomains: longTailExtractableDomains.size,
      longTailExtractableDomainList: [...longTailExtractableDomains].sort(),
      longTailFraction: totalDomains.size ? longTailDomains.size / totalDomains.size : 0,
      categoryCoverage: coveredCats.size,
      categoriesCovered: [...coveredCats].sort(),
      categoryDistribution: dist,
      gtRecall: gt.size ? gtHits / gt.size : null,
      gtHits,
      gtSize: gt.size,
      emberAgreement: emberAgree,
      meta: v.meta,
    }
  }

  writeFileSync(join(OUT, "labeled", `${slug}.json`), JSON.stringify({ query: raw.query, slug, labeled: labeledOut }, null, 2))
  writeFileSync(join(OUT, "scores", `${slug}.json`), JSON.stringify({ query: raw.query, slug, wantedCategories: LONG_TAIL, gtSize: gt.size, scores }, null, 2))

  // Console summary.
  console.log(`\n=== ${slug}: "${raw.query}" ===  (GT long-tail set: ${gt.size})`)
  const w = 10
  console.log(["method".padEnd(w), "domains", "LTdom", "LTextr", "LT%", "cats/4", "gtRec"].join("  "))
  for (const [m, s] of Object.entries<any>(scores)) {
    console.log([
      m.padEnd(w),
      String(s.totalDomains).padStart(7),
      String(s.longTailDomains).padStart(5),
      String(s.longTailExtractableDomains).padStart(6),
      `${(s.longTailFraction * 100).toFixed(0)}%`.padStart(4),
      `${s.categoryCoverage}`.padStart(6),
      s.gtRecall == null ? "  n/a" : `${(s.gtRecall * 100).toFixed(0)}%`.padStart(5),
    ].join("  "))
  }
}

main()
