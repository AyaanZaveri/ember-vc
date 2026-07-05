/**
 * URL canonicalization shared by every method + the ground-truth set, so
 * "did method X surface source Y" is a set-membership test that doesn't care
 * about http/https, www, trailing slashes, tracking params, or fragments.
 * Everyone is normalized the SAME way — that's the whole point.
 */

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "ref", "ref_src", "source", "mc_cid", "mc_eid",
])

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    u.hash = ""
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "")
    // Drop tracking params, keep meaningful ones (e.g. ?t= on forums, ?id=).
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key)
    }
    let path = u.pathname.replace(/\/+$/, "")
    if (path === "") path = "/"
    const qs = u.searchParams.toString()
    return `${u.hostname}${path}${qs ? `?${qs}` : ""}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

export function registrableDomain(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return ""
  }
}
