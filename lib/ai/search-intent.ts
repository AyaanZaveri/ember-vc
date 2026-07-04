export type SearchIntentDecision = "direct" | "search" | "classify"

export function getSearchIntentDecision(query: string): SearchIntentDecision {
  const normalized = query.toLowerCase()
  const trimmed = normalized.trim()

  if (!trimmed) {
    return "direct"
  }

  if (
    /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|lol|haha)[!.?]*$/i.test(
      query.trim()
    )
  ) {
    return "direct"
  }

  if (/https?:\/\/|www\./.test(normalized)) {
    return "search"
  }

  return "classify"
}

export function shouldUseSearch(query: string) {
  return getSearchIntentDecision(query) === "search"
}
