import { z } from "zod"

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Canonical schema for a Firecrawl-originated search source.
 * Used both for runtime validation and as a TypeScript type source.
 */
export const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
  snippet: z.string(),
  query: z.string(),
  readError: z.string().optional(),
  readSeconds: z.number().optional(),
  readStatus: z.enum(["complete", "error", "reading"]).optional(),
  /** Favicon URL from Firecrawl metadata — may be absent for some pages. */
  favicon: z.string().optional(),
})

export type ParsedSource = z.infer<typeof SourceSchema>

// ---------------------------------------------------------------------------
// Citation marker regex
// ---------------------------------------------------------------------------

/** Pattern for a single [n] marker — new instance created per call to avoid shared lastIndex. */
const SINGLE_MARKER_PATTERN = /\[(\d+)\]/g

/**
 * Normalizes common model citation variants into the canonical [n] markers
 * used by the renderer. Some models emit citations like `【1】` or
 * `【1†example.com】` despite prompt instructions.
 */
export function normalizeCitationMarkers(text: string): string {
  return text
    .replace(/【\s*(\d+)(?:[^】]*)?】/g, "[$1]")
    .replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_, group: string) =>
      group
        .split(/\s*,\s*/)
        .map((n) => `[${n}]`)
        .join("")
    )
}

/**
 * Given a raw bracket group like "[1][2]", returns [1, 2] (0-based indices
 * that map directly into the sources array — citations are 1-indexed in text).
 */
export function parseCitationGroup(group: string): number[] {
  const indices: number[] = []
  const re = new RegExp(SINGLE_MARKER_PATTERN)
  let match: RegExpExecArray | null

  while ((match = re.exec(group)) !== null) {
    const n = parseInt(match[1], 10)
    if (!isNaN(n) && n >= 1) {
      indices.push(n - 1) // convert to 0-based
    }
  }

  return indices
}

// ---------------------------------------------------------------------------
// Text-segment type
// ---------------------------------------------------------------------------

export type TextSegment =
  | { kind: "text"; content: string }
  | { kind: "citation"; raw: string; indices: number[] }

/**
 * Splits a markdown text string into alternating text and citation segments.
 *
 * Example:
 *   "Hello world [1][2]. More text [3]."
 *   →
 *   [
 *     { kind: "text",     content: "Hello world " },
 *     { kind: "citation", raw: "[1][2]", indices: [0, 1] },
 *     { kind: "text",     content: ". More text " },
 *     { kind: "citation", raw: "[3]",   indices: [2] },
 *     { kind: "text",     content: "." },
 *   ]
 */
export function parseTextWithCitations(text: string): TextSegment[] {
  // Use a capturing split so delimiters are included in the result array.
  text = normalizeCitationMarkers(text)
  const citationRe = /(\[\d+\](?:\[\d+\])*)/g
  const parts = text.split(citationRe)
  const segments: TextSegment[] = []

  for (const part of parts) {
    if (!part) continue

    // A part is a citation group when it matches the full pattern.
    if (/^\[\d+\](?:\[\d+\])*$/.test(part)) {
      segments.push({
        kind: "citation",
        raw: part,
        indices: parseCitationGroup(part),
      })
    } else {
      segments.push({ kind: "text", content: part })
    }
  }

  return segments
}

/**
 * Returns true when the text contains at least one citation marker so
 * that callers can quickly decide whether to run the full parse.
 */
export function hasCitations(text: string): boolean {
  text = normalizeCitationMarkers(text)
  return /\[\d+\]/.test(text)
}

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

/** Best-effort favicon URL: prefer the one from Firecrawl, else Google S2. */
export function resolveFaviconUrl(source: ParsedSource, size = 32): string {
  if (source.favicon) return source.favicon
  try {
    const hostname = new URL(source.url).hostname
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`
  } catch {
    return ""
  }
}

/** Safe hostname extraction that never throws. */
export function getSourceHostname(source: ParsedSource): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./, "")
  } catch {
    return source.url
  }
}
