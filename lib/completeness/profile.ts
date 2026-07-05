/**
 * A completeness profile is the per-client rubric: the source-type taxonomy the
 * classifier picks from, plus which of those types actually count for this
 * client. The taxonomy is DATA, not code — a different client (legal research,
 * say) would define government_filings / case_law / regulatory_comment and the
 * same classifier works unchanged. We demo against this coffee profile because
 * it maps to the actual customer transcript and it's the one place we can
 * hand-label real ground truth.
 */

export type CategoryId =
  | "trade_pub"
  | "regional_press"
  | "mainstream_press"
  | "forum"
  | "manufacturer"
  | "retailer"
  | "vendor_blog"
  | "other"

export type CompletenessProfile = {
  /** Human-readable name shown in the UI. */
  label: string
  /** One-line plain-English description of what this client wants. */
  description: string
  /** Every category the classifier may assign, with a one-line definition. */
  categories: { id: CategoryId; description: string }[]
  /** The category ids that satisfy this client — the deterministic match rule. */
  include: CategoryId[]
}

export const DEMO_PROFILE: CompletenessProfile = {
  label: "Competitive landscape report",
  description:
    "Wants the long-tail editorial and community coverage — trade press, regional press, and forums — not storefronts or mainstream SEO winners.",
  categories: [
    {
      id: "trade_pub",
      description:
        "An industry/professional publication, standards body, trade association, or certification program serving the trade (not a store).",
    },
    {
      id: "regional_press",
      description:
        "A local or regional news outlet or city/business journal covering the topic.",
    },
    {
      id: "mainstream_press",
      description:
        "A large, general-audience news or consumer publication (e.g. Wired, TechCrunch, The Verge, NYT) — high-authority, SEO-dominant, NOT an industry trade outlet.",
    },
    {
      id: "forum",
      description:
        "A discussion forum or Q&A community — general (Reddit, Quora, Stack Exchange) or a domain-specialist enthusiast forum.",
    },
    {
      id: "manufacturer",
      description:
        "The official website of a company that makes the product itself.",
    },
    {
      id: "retailer",
      description:
        "An e-commerce store or distributor selling the product — storefront, product, or collection pages.",
    },
    {
      id: "vendor_blog",
      description:
        "Content-marketing articles, buying guides, or 'how to choose' posts published by a retailer, vendor, or brand to attract buyers.",
    },
    {
      id: "other",
      description:
        "Anything else — video, generic spec-comparison aggregators, social posts, etc.",
    },
  ],
  // This client (from the transcript) wants long-tail editorial and community
  // coverage — trade press, regional press, and forums — NOT the storefronts
  // and vendor buying-guides that dominate the SEO-ranked results.
  include: ["trade_pub", "regional_press", "forum"],
}

/** The deterministic match rule: is this predicted category wanted by the client? */
export function matchesProfile(
  category: CategoryId,
  profile: CompletenessProfile
): boolean {
  return profile.include.includes(category)
}

/** Every category id the taxonomy knows about (the classifier's full label set). */
export const ALL_CATEGORY_IDS: CategoryId[] = DEMO_PROFILE.categories.map((c) => c.id)

/**
 * Build a profile from a user-chosen wanted-set. The taxonomy (the categories
 * the classifier picks from) stays fixed; only which of them "count" is
 * configurable — that's the per-client rubric the source-type picker edits, and
 * it's exactly the "let me tell search what I care about" control from #5.
 * Invalid/empty input falls back to the demo default so a bad request can't
 * produce a profile that wants nothing.
 */
export function profileWithInclude(include: string[]): CompletenessProfile {
  const valid = new Set<CategoryId>(ALL_CATEGORY_IDS)
  const filtered = include.filter((c): c is CategoryId => valid.has(c as CategoryId))
  return { ...DEMO_PROFILE, include: filtered.length ? filtered : DEMO_PROFILE.include }
}
