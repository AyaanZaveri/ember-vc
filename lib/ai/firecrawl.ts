const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search"
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape"
const FIRECRAWL_SNIPPET_MAX_LENGTH = 1600
const FIRECRAWL_SCRAPE_TIMEOUT_MS = 6000

export const FRESHNESS_POLICY_MAX_AGE_MS = {
  live: 1000,
  veryFresh: 5 * 60 * 1000,
  fresh: 60 * 60 * 1000,
  normal: 2 * 24 * 60 * 60 * 1000,
  cached: 60 * 24 * 60 * 60 * 1000,
} as const

export type FreshnessPolicy = keyof typeof FRESHNESS_POLICY_MAX_AGE_MS

type FirecrawlSearchBody = {
  query: string
  limit?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  maxAge?: number
  scrapeContent?: boolean
}

type FirecrawlSearchItem = {
  title?: string
  description?: string
  url?: string
  markdown?: string
  metadata?: {
    title?: string
    description?: string
    sourceURL?: string
    url?: string
    statusCode?: number
    error?: string
    favicon?: string
    ogImage?: string
  }
}

type FirecrawlSearchResponse = {
  success?: boolean
  warning?: string
  data?: {
    web?: FirecrawlSearchItem[]
  }
}

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: FirecrawlSearchItem
}

export type SearchResultSource = {
  title: string
  url: string
  description: string
  snippet: string
  query: string
  readError?: string
  readSeconds?: number
  readStatus?: "complete" | "error" | "reading"
  /** Favicon URL from Firecrawl metadata — may be undefined for some pages. */
  favicon?: string
}

export const FIRECRAWL_EXCLUDED_DOMAINS = [
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
] as const

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}...`
}

function normalizeText(text: string | undefined, fallback = "") {
  return text?.replace(/\s+/g, " ").trim() ?? fallback
}

function toSearchResultSource({
  item,
  query,
}: {
  item: FirecrawlSearchItem
  query: string
}): SearchResultSource | null {
  const url = item.url ?? item.metadata?.sourceURL ?? item.metadata?.url

  if (!url) {
    return null
  }

  const title = normalizeText(item.title ?? item.metadata?.title, url)
  const description = normalizeText(
    item.description ?? item.metadata?.description,
    "No description available."
  )
  const snippet = truncate(
    normalizeText(item.markdown, description || title),
    FIRECRAWL_SNIPPET_MAX_LENGTH
  )

  return {
    title,
    url,
    description,
    snippet,
    query,
    readStatus: item.markdown ? "complete" : undefined,
    favicon: item.metadata?.favicon || undefined,
  }
}

function isExcludedDomain(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()

    return FIRECRAWL_EXCLUDED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    )
  } catch {
    return false
  }
}

export function filterExcludedSources(sources: SearchResultSource[]) {
  return sources.filter((source) => !isExcludedDomain(source.url))
}

export function getCiteableSources(sources: SearchResultSource[]) {
  return filterExcludedSources(sources).filter(
    (source) => source.readStatus === "complete" && source.snippet.trim()
  )
}

export async function firecrawlSearch({
  query,
  limit = 5,
  excludeDomains = [...FIRECRAWL_EXCLUDED_DOMAINS],
  includeDomains,
  maxAge,
  scrapeContent = true,
}: FirecrawlSearchBody) {
  const apiKey = process.env.FIRECRAWL_API_KEY

  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY")
  }

  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      sources: ["web"],
      country: "US",
      ignoreInvalidURLs: true,
      ...(includeDomains?.length ? { includeDomains } : {}),
      ...(!includeDomains?.length && excludeDomains.length
        ? { excludeDomains }
        : {}),
      ...(scrapeContent
        ? {
            scrapeOptions: {
              formats: ["markdown"],
              maxAge,
              onlyMainContent: true,
              proxy: "basic",
              storeInCache: true,
            },
          }
        : {}),
    }),
  })

  if (!response.ok) {
    throw new Error(`Firecrawl search failed with status ${response.status}`)
  }

  const payload = (await response.json()) as FirecrawlSearchResponse
  const items = payload.data?.web ?? []

  const sources = items
    .map((item) => toSearchResultSource({ item, query }))
    .filter((item): item is SearchResultSource => item !== null)
    .filter((source) => !isExcludedDomain(source.url))

  return {
    query,
    warning: payload.warning,
    sources,
  }
}

export async function firecrawlScrapeSource({
  maxAge,
  source,
}: {
  maxAge?: number
  source: SearchResultSource
}) {
  const apiKey = process.env.FIRECRAWL_API_KEY

  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY")
  }

  const response = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: source.url,
      formats: ["markdown"],
      maxAge,
      onlyMainContent: true,
      proxy: "basic",
      storeInCache: true,
      timeout: FIRECRAWL_SCRAPE_TIMEOUT_MS,
    }),
    signal: AbortSignal.timeout(FIRECRAWL_SCRAPE_TIMEOUT_MS + 2000),
  })

  if (!response.ok) {
    throw new Error(`Firecrawl scrape failed with status ${response.status}`)
  }

  const payload = (await response.json()) as FirecrawlScrapeResponse
  const scrapedSource = payload.data
    ? toSearchResultSource({ item: payload.data, query: source.query })
    : null

  if (!payload.success || !scrapedSource) {
    throw new Error("Firecrawl scrape returned no content")
  }

  return {
    ...source,
    ...scrapedSource,
    url: source.url,
    query: source.query,
    favicon: scrapedSource.favicon ?? source.favicon,
  }
}
