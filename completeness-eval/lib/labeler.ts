/**
 * Method-AGNOSTIC source-type labeler. The single most important fairness
 * control in this eval: every method's output AND the ground-truth set are
 * labeled by THIS one function, using domain + URL-path heuristics only —
 * never by any method's own classifier. So "long-tail source" means the same
 * thing for the baseline and for Ember.
 *
 * Taxonomy mirrors Ember's profile.ts so results are directly comparable, but
 * the LOGIC here is independent (curated domain lists + path rules), and the
 * labels are frozen to a per-topic table that I spot-check by hand before any
 * score is computed. Heuristic, transparent, and auditable — not gold, but the
 * SAME lens on all three, which is what makes the comparison honest.
 */

import { registrableDomain } from "./normalize.ts"

export type Category =
  | "trade_pub"
  | "regional_press"
  | "mainstream_press"
  | "community_forum"
  | "niche_forum"
  | "manufacturer"
  | "retailer"
  | "vendor_blog"
  | "social_video"
  | "reference"
  | "other"

/** The customer's ask (Ember's demo include set): long-tail editorial + community. */
export const LONG_TAIL: Category[] = [
  "trade_pub",
  "regional_press",
  "community_forum",
  "niche_forum",
]

export function isLongTail(cat: Category): boolean {
  return LONG_TAIL.includes(cat)
}

// Domains Firecrawl can surface in search but can't reliably scrape (bot-blocked).
// Mirrors Ember's own NON_EXTRACTABLE_DOMAINS in lib/completeness/discover.ts — a
// long-tail source you can't extract can be flagged for manual review but can't be
// cited in a report, so we score extractable long-tail separately.
const NON_EXTRACTABLE = new Set([
  "reddit.com", "quora.com", "youtube.com", "facebook.com", "instagram.com",
  "threads.com", "x.com", "twitter.com", "tiktok.com", "pinterest.com",
  "spotify.com", "last.fm", "linkedin.com",
])

export function isExtractable(rawUrl: string): boolean {
  const domain = registrableDomain(rawUrl)
  if (!domain) return true
  return ![...NON_EXTRACTABLE].some((d) => domain === d || domain.endsWith(`.${d}`))
}

// --- Curated domain sets. Kept explicit so a reviewer can see exactly why a
// URL got its label. These are the SEO-winner publishers the customer says
// bury the long tail (#1: "forty more of the same SEO winners"). ---

const MAINSTREAM_PRESS = new Set([
  "wired.com", "theverge.com", "nytimes.com", "cnet.com", "forbes.com",
  "seriouseats.com", "techcrunch.com", "businessinsider.com", "engadget.com",
  "tomsguide.com", "techradar.com", "pcmag.com", "gizmodo.com", "mashable.com",
  "wsj.com", "cnbc.com", "theguardian.com", "washingtonpost.com", "bbc.com",
  "usatoday.com", "time.com", "vox.com", "arstechnica.com", "digitaltrends.com",
  "goodhousekeeping.com", "epicurious.com", "foodandwine.com", "bonappetit.com",
  "thespruceeats.com", "reviewed.com", "popsci.com", "zdnet.com", "venturebeat.com",
  "fastcompany.com", "inc.com", "entrepreneur.com", "fortune.com", "reuters.com",
  "gartner.com", "forrester.com", "g2.com", "capterra.com", "trustradius.com",
  "softwareadvice.com", "pcworld.com", "lifewire.com", "cnn.com",
])

// Community forums: giant general-purpose Q&A / discussion.
const COMMUNITY_FORUM = new Set([
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com",
  "ycombinator.com", "news.ycombinator.com", "medium.com",
])

// Regional press: local TV, city/business journals, and local-news networks.
const REGIONAL_PRESS_DOMAINS = new Set([
  "patch.com", "bizjournals.com", "golocalprov.com", "wpri.com",
  "johnsoncountypost.com", "ibj.com", "crainsdetroit.com", "crainschicago.com",
])
// Regional-press URL/host signatures. NOTE: an earlier version had a generic
// broadcast-callsign regex /w[a-z]{2,4}\.com$/ — it false-matched vendor domains
// like wave.com (an accounting product), inventing "regional_press" hits. Removed:
// real local outlets are covered by the curated set + per-topic allowlist instead.
const REGIONAL_PRESS_PATTERNS = [
  /(^|\.)(abc|nbc|cbs|fox)\d{1,2}(\.|-)/, // fox5., abc7-...  network affiliates
  /localnews|\.patch\.com$/,
]

// Niche / specialist enthusiast forums for a domain.
const NICHE_FORUM_DOMAINS = new Set([
  "home-barista.com", "coffeeforums.com", "baristaexchange.com",
  "coffeeforums.co.uk", "coffeegeek.com",
])
const NICHE_FORUM_PATTERNS = [/forum/, /community\./, /(^|\.)forums?\./]

// Trade / industry bodies, standards orgs, associations, certification programs.
const TRADE_PUB_DOMAINS = new Set([
  "sca.coffee", "scanews.coffee", "dailycoffeenews.com", "perfectdailygrind.com",
  "beveragedaily.com", "worldcoffeeportal.com", "tea-and-coffee.net",
])
const TRADE_PUB_PATTERNS = [
  /association|\.org\/(standards|certif)/,
]

// Retailers / stores / distributors (storefronts).
const RETAILER_PATTERNS = [
  /\/collections?\//, /\/product(s)?\//, /\/shop\b/, /\/store\b/, /\/cart\b/,
  /\/buy\b/, /\/pricing\b/,
]
const RETAILER_DOMAINS = new Set([
  "amazon.com", "ebay.com", "walmart.com", "target.com", "bestbuy.com",
  "wholelatte lovecom", "wholelattelove.com", "seattlecoffeegear.com",
  "clivecoffee.com", "prima-coffee.com", "chriscoffee.com", "procoffeegear.com",
  "coffeemachinedepot.com", "espresso-works.com", "espressoparts.com",
])

// Manufacturers (official brand sites).
const MANUFACTURER_DOMAINS = new Set([
  "lamarzocco.com", "lamarzoccousa.com", "nuovasimonelli.it", "nuovasimonelli.com",
  "breville.com", "rancilio.com", "rocket-espresso.com", "victoriaarduino.com",
  "sanremomachines.com", "lacimbali.com", "slayerespresso.com",
])

// Vendor blogs / content marketing / buying guides published by a store or brand.
const VENDOR_BLOG_PATTERNS = [
  /\/blogs?\//, /\/learning-center\//, /\/guides?\//, /how-to-choose/,
  /buying-guide/, /best-.*-(for|of|brands|manufacturers)/, /\/news-events\//,
  /\/resources?\//, /\/opinions?\//, /coffee-guide/, /top-\d+-/, /top-.*-brands/,
  /-(vs|versus)-/, /which-.*-(is-better|to-(buy|choose))/, /-review(s)?(\/|$)/,
]

// Social / video / streaming — never a citable long-tail editorial source.
const SOCIAL_VIDEO_DOMAINS = new Set([
  "youtube.com", "m.youtube.com", "youtu.be", "instagram.com", "facebook.com",
  "m.facebook.com", "tiktok.com", "x.com", "twitter.com", "threads.com",
  "pinterest.com", "spotify.com", "open.spotify.com", "last.fm", "soundcloud.com",
  "linkedin.com", "vimeo.com",
])
const REFERENCE_DOMAINS = new Set([
  "en.wikipedia.org", "wikipedia.org", "fandom.com", "wikihow.com",
])
// Generic storefront path/host signals beyond the curated retailer list.
const RETAILER_EXTRA_PATTERNS = [
  /\/catalog\//, /\/showroom\//, /\/brands?\.html/, /\/all-commercial/,
  /\/wholesale\b/, /\/equipment\b/, /-grinders?(\/|$)/, /storefront/,
]

function anyMatch(patterns: RegExp[], hay: string): boolean {
  return patterns.some((p) => p.test(hay))
}

export type LabelReason = { category: Category; signal: string }

/**
 * Label a single URL. Order matters: specific/structural signals first,
 * publisher allowlists next, generic fallbacks last. Returns the signal used
 * so the frozen table is auditable.
 */
export function labelUrl(
  rawUrl: string,
  allowlist: Record<string, Category> = {}
): LabelReason {
  const domain = registrableDomain(rawUrl)
  const url = rawUrl.toLowerCase()

  // -1. Per-topic allowlist (built independently via the WebSearch oracle, in
  // topics/<slug>.gt.json). This is what makes the generic labeler topic-aware:
  // it teaches it that e.g. pv-magazine.com is trade_pub for the solar topic.
  // Applied FIRST and IDENTICALLY to every method's output — same knowledge base
  // for the baseline and for Ember — so it can't advantage either one.
  for (const [d, cat] of Object.entries(allowlist)) {
    if (domain === d || domain.endsWith(`.${d}`)) {
      return { category: cat, signal: `topic allowlist ${d}` }
    }
  }

  // 0. Social/video/streaming and reference — unambiguous, and never the
  // long-tail editorial/community sources the customer is asking for.
  if ([...SOCIAL_VIDEO_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { category: "social_video", signal: `social/video ${domain}` }
  }
  if ([...REFERENCE_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { category: "reference", signal: `reference ${domain}` }
  }

  // 1. Big general communities (exact-domain, unambiguous).
  if (
    [...COMMUNITY_FORUM].some((d) => domain === d || domain.endsWith(`.${d}`))
  ) {
    return { category: "community_forum", signal: `community domain ${domain}` }
  }

  // 2. Curated publisher allowlists.
  if (MAINSTREAM_PRESS.has(domain)) {
    return { category: "mainstream_press", signal: `mainstream publisher ${domain}` }
  }
  if (TRADE_PUB_DOMAINS.has(domain)) {
    return { category: "trade_pub", signal: `trade/industry publisher ${domain}` }
  }
  if (NICHE_FORUM_DOMAINS.has(domain)) {
    return { category: "niche_forum", signal: `specialist forum ${domain}` }
  }
  if (REGIONAL_PRESS_DOMAINS.has(domain)) {
    return { category: "regional_press", signal: `regional outlet ${domain}` }
  }
  if (MANUFACTURER_DOMAINS.has(domain)) {
    return { category: "manufacturer", signal: `manufacturer ${domain}` }
  }

  // 3. Structural URL signals (host/path patterns).
  if (anyMatch(NICHE_FORUM_PATTERNS, domain) || anyMatch(NICHE_FORUM_PATTERNS, url)) {
    return { category: "niche_forum", signal: "forum host/path signal" }
  }
  if (anyMatch(REGIONAL_PRESS_PATTERNS, domain)) {
    return { category: "regional_press", signal: "local-broadcast/city host signal" }
  }
  if (anyMatch(TRADE_PUB_PATTERNS, url)) {
    return { category: "trade_pub", signal: "association/standards path signal" }
  }
  // Vendor blog BEFORE retailer: a store's /blog/best-... is content marketing.
  if (anyMatch(VENDOR_BLOG_PATTERNS, url)) {
    return { category: "vendor_blog", signal: "buying-guide/blog path signal" }
  }
  if (
    RETAILER_DOMAINS.has(domain) ||
    anyMatch(RETAILER_PATTERNS, url) ||
    anyMatch(RETAILER_EXTRA_PATTERNS, url)
  ) {
    return { category: "retailer", signal: "storefront domain/path signal" }
  }

  return { category: "other", signal: "no strong signal" }
}
