/**
 * Orchestrator: run each method on one topic, label every result with the
 * SHARED labeler, and write raw + labeled output. Each method is a black box:
 *   - baseline: Firecrawl /v2/search limit 50 (what the customer does today, #1)
 *   - ember:    Ember's discoverAndClassify via its own runner script
 *
 * Usage: FIRECRAWL_API_KEY=... bun runners/orchestrate.ts "<query>" <slug>
 */
import { spawn } from "node:child_process"
import { writeFileSync, readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalUrl, registrableDomain } from "../lib/normalize.ts"
import { labelUrl, isLongTail, type Category } from "../lib/labeler.ts"

// Paths derived from this file's location — no hardcoded home directory.
// runners/ -> completeness-eval/ (OUT_DIR) -> ember/ (EMBER_DIR).
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, "..")
const EMBER_DIR = join(HERE, "..", "..")

type RawSource = { url: string; title?: string; description?: string; emberCategory?: string; emberMatches?: boolean }
type LabeledSource = {
  url: string
  canonical: string
  domain: string
  title: string
  category: Category
  signal: string
  longTail: boolean
  emberCategory?: string
  emberMatches?: boolean
}

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } })
    let stdout = "", stderr = ""
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }) })
  })
}

// One Firecrawl /v2/search call → RawSource[]. Retried on transient failure so a
// single flaky call never sinks a probe set.
async function fcSearch(
  query: string,
  opts: { limit: number; excludeDomains?: string[] } = { limit: 10 }
): Promise<RawSource[]> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) throw new Error("FIRECRAWL_API_KEY not set")
  const body: Record<string, unknown> = {
    query, limit: opts.limit, sources: ["web"], country: "US", ignoreInvalidURLs: true,
  }
  if (opts.excludeDomains?.length) body.excludeDomains = opts.excludeDomains
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`search ${res.status}`)
      const json = await res.json() as { data?: { web?: { url?: string; title?: string; description?: string }[] } }
      const items = json.data?.web ?? []
      return items.filter((i) => i.url).map((i) => ({ url: i.url!, title: i.title, description: i.description }))
    } catch (e) {
      if (attempt === 2) { console.warn(`[fcSearch] "${query.slice(0, 60)}" failed: ${(e as Error).message}`); return [] }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  return []
}

// --- baseline: one Firecrawl search, limit 50, web. Mirrors "we run search at
// limit 50" from call #1 — the head-heavy ranked list the customer complains about.
async function runBaseline(query: string): Promise<RawSource[]> {
  return fcSearch(query, { limit: 50 })
}

// Top-N most frequent domains in a result set — the SEO winners to exclude.
function topDomainsOf(sources: RawSource[], n: number): string[] {
  const freq = new Map<string, number>()
  for (const s of sources) {
    const d = registrableDomain(s.url)
    if (d) freq.set(d, (freq.get(d) ?? 0) + 1)
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([d]) => d)
}

// --- operators: a deterministic, ZERO-LLM recipe of STRUCTURAL search operators,
// unioned. No hardcoded sites (no `site:reddit.com` cherry-picking) — only generic
// operators that find the long tail by shape, so it generalizes to any topic.
// Firecrawl /v2/search supports operators in the query string (intitle:, inurl:,
// OR, exact phrase) plus structured excludeDomains.
//   1. base query — also used to learn the SEO-winner domains to exclude
//   2. {query} intitle:forum   → forums (by page title)
//   3. {query} inurl:forum     → forums (by URL) — catches ones intitle: misses
//   4. {query} magazine OR journal OR association → trade press (generic keywords)
//   5. {query} excluding the top base domains → the tail beneath the SEO winners
async function runOperators(query: string): Promise<{ sources: RawSource[]; meta: any }> {
  const base = await fcSearch(query, { limit: 20 })
  const topDomains = topDomainsOf(base, 6)

  const probes: { label: string; run: () => Promise<RawSource[]> }[] = [
    { label: "intitle:forum", run: () => fcSearch(`${query} intitle:forum`, { limit: 10 }) },
    { label: "inurl:forum", run: () => fcSearch(`${query} inurl:forum`, { limit: 10 }) },
    { label: "magazine OR journal OR association", run: () => fcSearch(`${query} magazine OR journal OR association`, { limit: 10 }) },
    { label: "exclude-top-domains", run: () => fcSearch(query, { limit: 15, excludeDomains: topDomains }) },
  ]
  const probeResults = await Promise.all(probes.map((p) => p.run()))
  const sources = [base, ...probeResults].flat()
  return {
    sources,
    meta: { probes: ["base@20", ...probes.map((p) => p.label)], excludedTopDomains: topDomains, results: sources.length },
  }
}

// --- llm-operators: the LLM writes the dorks. Same operator LEVER as above, but
// instead of a fixed recipe the model generates topic-tailored operator queries
// (intitle:/inurl:/OR/exclusions/quotes) aimed at trade pubs, associations, local
// press, and specialist forums. No bare vendor names, no hardcoded sites — so it
// stays principled while adapting to the topic. Tests "does LLM-generated beat the
// fixed recipe?" head to head.
async function runLlmOperators(query: string): Promise<{ sources: RawSource[]; meta: any }> {
  const dorks = await generateDorks(query)
  const base = await fcSearch(query, { limit: 20 })
  const probeResults = await Promise.all(dorks.map((d) => fcSearch(d, { limit: 10 })))
  const sources = [base, ...probeResults].flat()
  return { sources, meta: { generatedDorks: dorks, results: sources.length } }
}

// Ask the NIM model (same one Ember uses) for operator-structured search queries.
// Falls back to the fixed structural recipe if the model is unavailable/unparseable
// — the method must never hard-depend on the LLM being up.
async function generateDorks(query: string): Promise<string[]> {
  const key = process.env.NVIDIA_NIM_API_KEY
  const fallback = [
    `${query} intitle:forum`,
    `${query} inurl:forum`,
    `${query} magazine OR journal OR association`,
  ]
  if (!key) return fallback
  const prompt = [
    `Topic: "${query}"`,
    "Write 6 web-search queries that use Google search OPERATORS to surface hard-to-find,",
    "long-tail sources for a competitive-landscape report: trade/industry publications,",
    "industry associations & standards bodies, regional/local news, and specialist forums.",
    "Use operators like intitle:, inurl:, \"exact phrase\", OR, and -exclusions.",
    "Rules: do NOT use site: pinned to a specific domain (no guessing exact sites).",
    "Do NOT just list vendor/product names. Each query must include the topic.",
    'Return ONLY a JSON array of query strings, e.g. ["q1","q2",...].',
  ].join("\n")
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen/qwen3-next-80b-a3b-instruct",
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`nim ${res.status}`)
    const json = await res.json() as { choices?: { message?: { content?: string } }[] }
    const text = json.choices?.[0]?.message?.content ?? ""
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]")
    const dorks = (Array.isArray(arr) ? arr : [])
      .map((x) => String(x).trim())
      .filter((s) => s.length > 2 && s.length < 200)
      .slice(0, 6)
    return dorks.length ? dorks : fallback
  } catch (e) {
    console.warn(`[llm-operators] dork generation failed, using fallback: ${(e as Error).message}`)
    return fallback
  }
}

// --- ember: its discovery pipeline via the runner script we placed in its repo.
async function runEmber(query: string): Promise<{ sources: RawSource[]; meta: any }> {
  const { code, stdout, stderr } = await sh("node", ["--env-file=.env", "tests/_eval_discover.ts", query], {
    cwd: EMBER_DIR,
    timeoutMs: 300_000,
  })
  if (code !== 0 || !stdout.trim()) throw new Error(`ember failed (code ${code}): ${stderr.slice(-400)}`)
  const parsed = JSON.parse(stdout)
  const sources: RawSource[] = parsed.sources.map((s: any) => ({
    url: s.url, title: s.title, description: s.description, emberCategory: s.emberCategory, emberMatches: s.emberMatches,
  }))
  return { sources, meta: { queriesRun: parsed.queriesRun, rawSourceCount: parsed.rawSourceCount, results: sources.length } }
}

// Dedupe by canonical URL and apply the shared label to each survivor.
function labelAll(sources: RawSource[]): LabeledSource[] {
  const seen = new Map<string, LabeledSource>()
  for (const s of sources) {
    const canonical = canonicalUrl(s.url)
    if (seen.has(canonical)) continue
    const { category, signal } = labelUrl(s.url)
    seen.set(canonical, {
      url: s.url,
      canonical,
      domain: registrableDomain(s.url),
      title: s.title ?? "",
      category,
      signal,
      longTail: isLongTail(category),
      emberCategory: s.emberCategory,
      emberMatches: s.emberMatches,
    })
  }
  return [...seen.values()]
}

const METHODS: Record<string, (q: string) => Promise<{ sources: RawSource[]; meta: any }>> = {
  baseline: async (q) => ({ sources: await runBaseline(q), meta: { results: 50 } }),
  operators: runOperators,
  "llm-operators": runLlmOperators,
  ember: runEmber,
}

async function main() {
  const query = process.argv[2]
  const slug = process.argv[3]
  // Optional CSV of methods to (re)run; others in an existing raw file are kept.
  // e.g. bun orchestrate.ts "..." solar operators   → run only operators, merge.
  const only = process.argv[4]?.split(",").map((s) => s.trim()).filter(Boolean)
  if (!query || !slug) { console.error("usage: bun orchestrate.ts \"<query>\" <slug> [methodsCSV]"); process.exit(1) }

  const rawPath = join(OUT_DIR, "raw", `${slug}.json`)
  // Start from any existing raw so a partial re-run preserves the other methods.
  let results: Record<string, { sources: LabeledSource[]; meta: any }> = {}
  if (existsSync(rawPath)) {
    try { results = JSON.parse(readFileSync(rawPath, "utf8")).results ?? {} } catch { /* fresh */ }
  }

  const toRun = only ?? Object.keys(METHODS)
  for (const name of toRun) {
    const fn = METHODS[name]
    if (!fn) { process.stderr.write(`[${name}] unknown method, skipping\n`); continue }
    process.stderr.write(`\n[${name}] running "${query}"...\n`)
    try {
      const { sources, meta } = await fn(query)
      const labeled = labelAll(sources)
      results[name] = { sources: labeled, meta }
      const lt = labeled.filter((s) => s.longTail).length
      process.stderr.write(`[${name}] ${labeled.length} unique, ${lt} long-tail (${labeled.length ? ((lt / labeled.length) * 100).toFixed(0) : 0}%)\n`)
    } catch (e) {
      process.stderr.write(`[${name}] FAILED: ${(e as Error).message}\n`)
      results[name] = { sources: [], meta: { error: (e as Error).message } }
    }
  }

  writeFileSync(rawPath, JSON.stringify({ query, slug, generatedAt: new Date().toISOString(), results }, null, 2))
  process.stderr.write(`\nsaved ${rawPath}\n`)
}

main()
