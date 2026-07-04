function getRegionFromLocale(locale: string) {
  const normalizedLocale = locale.trim()
  const regionMatch = normalizedLocale.match(/[-_]([a-z]{2}|\d{3})\b/i)

  return regionMatch?.[1]?.toUpperCase()
}

function getRuntimeLocale() {
  if (typeof navigator !== "undefined") {
    return navigator.languages?.[0] ?? navigator.language ?? "en-US"
  }

  return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
}

function getRuntimeTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

export function getCurrentRequestContext() {
  const now = new Date()
  const locale = getRuntimeLocale()
  const timeZone = getRuntimeTimeZone()
  const region = getRegionFromLocale(locale)
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    weekday: "long",
    year: "numeric",
  }).formatToParts(now)
  const partMap = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  )

  return [
    `Current UTC time: ${now.toISOString()}`,
    `Local date/time: ${partMap.weekday}, ${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second}`,
    `Timezone: ${timeZone}`,
    `Locale: ${locale}`,
    region ? `Region: ${region}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}
