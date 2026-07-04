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
  | "community_forum"
  | "niche_forum"
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
      id: "community_forum",
      description:
        "A large, general-purpose discussion or Q&A community such as Reddit, Quora, or Stack Exchange.",
    },
    {
      id: "niche_forum",
      description:
        "A small, domain-specialist enthusiast forum dedicated to this subject.",
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
  include: ["trade_pub", "regional_press", "community_forum", "niche_forum"],
}

/** The deterministic match rule: is this predicted category wanted by the client? */
export function matchesProfile(
  category: CategoryId,
  profile: CompletenessProfile
): boolean {
  return profile.include.includes(category)
}
