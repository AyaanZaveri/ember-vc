import { type CategoryId, type CompletenessProfile } from "./profile.ts"

/**
 * Category-targeted probes: extra searches aimed at the specific long-tail
 * source types the user asked for. Generic expansion is blind to the wanted-set,
 * so the categories the whole product exists to surface (forums, trade press,
 * regional press) come back thin. These probes cast a net shaped for each one.
 *
 * Design (settled by design review):
 *  - Only the four HARD long-tail categories get probes, and only when wanted.
 *    Retailer/vendor/mainstream already flood the generic round — probing them
 *    would burn credits re-finding SEO winners.
 *  - HYBRID query construction: the LLM proposes topic-appropriate VOCABULARY;
 *    the fixed per-category template owns the OPERATORS. The model never writes a
 *    dork, so it can't over-constrain (the failure mode we saw when it wrote
 *    whole queries). No LLM / vocab? The template still works on its own.
 *  - Operator whitelist: keyword OR-groups + soft intitle:/inurl: (page-kind,
 *    domain-agnostic). Hard site:/-site: is BANNED — it collapses recall and the
 *    "right" site varies by topic (the user's explicit rule).
 *  - Precision: every probe is topic-anchored ({topic} + …), and a lexical
 *    relevance floor (below) drops off-topic-but-right-shape pages.
 */

/** The hard-to-surface set. Probing is gated on wanted ∩ this. */
export const LONG_TAIL_CATEGORIES: CategoryId[] = ["trade_pub", "regional_press", "forum"]

/** The wanted long-tail categories for a profile — the ones we actually probe. */
export function wantedLongTail(profile: CompletenessProfile): CategoryId[] {
  return LONG_TAIL_CATEGORIES.filter((c) => profile.include.includes(c))
}

/** OR-group of terms, quoting multi-word phrases. Empty in → empty string. */
function orGroup(terms: string[]): string {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))]
  if (cleaned.length === 0) return ""
  return `(${cleaned.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" OR ")})`
}

/**
 * Per-category template. Operators are fixed here; `vocab` (LLM-proposed, topic
 * specific) only ever enters as extra OR-terms — never as operators. Each returns
 * a single probe query anchored on the topic.
 */
// Keep probes CLEAN and BROAD. The eval showed that piling the LLM's full
// vocabulary into a long OR-chain (7+ terms, quoted phrases) underperforms a
// short, broad query — it's a milder version of the over-constraining failure
// we saw when the model wrote whole dorks. So: fixed operator scaffold + AT MOST
// one topic-specific vocab term.
const TEMPLATES: Record<CategoryId, (topic: string, vocab: string[]) => string> = {
  // Forums (general + niche, merged): a broad keyword-OR of discussion signals.
  // NO intitle:forum — Reddit/Quora threads rarely have "forum" in the title, so
  // that operator would starve the general half of the category.
  forum: (topic, vocab) =>
    `${topic} ${orGroup(["forum", "discussion", "community", ...vocab.slice(0, 1)])}`,
  // Trade press: generic trade words + one topic-specific term (e.g. "roaster").
  trade_pub: (topic, vocab) =>
    `${topic} ${orGroup(["magazine", "journal", "association", ...vocab.slice(0, 1)])}`,
  // Regional press: weakest single signal, so lean on local-news phrasings.
  regional_press: (topic, vocab) =>
    `${topic} ${orGroup(["local news", "now open", ...vocab.slice(0, 1)])}`,
  // Not probed (easy categories) — present only to satisfy the exhaustive record.
  mainstream_press: (topic) => topic,
  manufacturer: (topic) => topic,
  retailer: (topic) => topic,
  vendor_blog: (topic) => topic,
  other: (topic) => topic,
}

export function buildCategoryProbeQuery(
  topic: string,
  category: CategoryId,
  vocab: string[]
): string {
  return TEMPLATES[category](topic.trim(), vocab).trim()
}

// --- Precision guard: a deterministic lexical relevance floor, scoped ONLY to
// category-probe results (never the rest of the pipeline). A probe like
// "{topic} (forum OR discussion)" can rank a right-shaped but off-topic thread;
// this requires the result to actually mention the topic before we keep it. ---

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "best",
  "top", "good", "great", "vs", "versus", "how", "what", "which", "your", "you",
  "my", "is", "are", "at", "by", "from", "about", "guide", "review", "reviews",
])

/** Significant (content) tokens of the topic — used by the relevance floor. */
function topicTokens(topic: string): string[] {
  return [
    ...new Set(
      topic
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    ),
  ]
}

/**
 * Keep a probe result only if its title+description mentions at least one
 * significant topic token. Cheap, deterministic, no LLM. Empty topic tokens
 * (degenerate query) → keep everything rather than drop the whole probe.
 */
export function makeTopicRelevanceFloor(
  topic: string
): (text: { title?: string; description?: string }) => boolean {
  const tokens = topicTokens(topic)
  if (tokens.length === 0) return () => true
  return ({ title = "", description = "" }) => {
    const hay = `${title} ${description}`.toLowerCase()
    return tokens.some((t) => hay.includes(t))
  }
}
