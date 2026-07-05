/**
 * Zero-network unit tests for the depth-loop control logic. No Firecrawl, no
 * LLM — pure functions with fake data. Run: node tests/effort.test.ts
 */
import assert from "node:assert"
import {
  EFFORT_PRESETS,
  resolveEffort,
  newWantedDomains,
  hitCeiling,
  domainOf,
} from "../lib/completeness/effort.ts"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

// --- newWantedDomains: the saturation signal ---
check("counts only NEW WANTED domains, ignores filtered + seen", () => {
  const classified = [
    { url: "https://sca.coffee/x", matches: true, category: "trade_pub" as const }, // new wanted
    { url: "https://www.reddit.com/r/coffee", matches: true, category: "forum" as const }, // new wanted
    { url: "https://amazon.com/dp/1", matches: false, category: "retailer" as const }, // filtered -> ignored
    { url: "https://sca.coffee/y", matches: true, category: "trade_pub" as const }, // same domain -> dedup
  ]
  const seen = new Set<string>(["reddit.com"]) // reddit already seen
  const fresh = newWantedDomains(classified, seen)
  assert.deepStrictEqual(fresh.sort(), ["sca.coffee"]) // only the genuinely-new wanted domain
})

check("empty when a round adds no new wanted domains (a 'dry' round)", () => {
  const classified = [
    { url: "https://amazon.com/dp/2", matches: false, category: "retailer" as const },
    { url: "https://sca.coffee/z", matches: true, category: "trade_pub" as const },
  ]
  const seen = new Set<string>(["sca.coffee"])
  assert.strictEqual(newWantedDomains(classified, seen).length, 0)
})

// --- hitCeiling: the hard backstop ---
check("ceiling fires on round > maxRounds", () => {
  const cfg = EFFORT_PRESETS.standard // maxRounds 2, maxSearches 20
  assert.strictEqual(hitCeiling(cfg, { round: 3, searchCount: 5 }), true)
  assert.strictEqual(hitCeiling(cfg, { round: 2, searchCount: 5 }), false)
})

check("ceiling fires on searchCount >= maxSearches", () => {
  const cfg = EFFORT_PRESETS.standard // maxSearches 20
  assert.strictEqual(hitCeiling(cfg, { round: 2, searchCount: 20 }), true)
  assert.strictEqual(hitCeiling(cfg, { round: 2, searchCount: 19 }), false)
})

// --- presets & resolution ---
check("presets ordered by depth (rounds & scrape budget increase)", () => {
  const p = EFFORT_PRESETS
  assert.ok(p.quick.maxRounds <= p.standard.maxRounds)
  assert.ok(p.standard.maxRounds < p.thorough.maxRounds)
  assert.ok(p.thorough.maxRounds < p.exhaustive.maxRounds)
  assert.strictEqual(p.quick.scrapeWanted, false)
  assert.strictEqual(p.standard.scrapeWanted, false)
  assert.strictEqual(p.thorough.scrapeWanted, true)
  assert.ok(p.exhaustive.maxScrapes >= p.thorough.maxScrapes)
})

check("resolveEffort defaults to standard; passes configs through", () => {
  assert.strictEqual(resolveEffort(), EFFORT_PRESETS.standard)
  assert.strictEqual(resolveEffort("thorough"), EFFORT_PRESETS.thorough)
  // unknown string -> standard (defensive)
  assert.strictEqual(resolveEffort("bogus" as never), EFFORT_PRESETS.standard)
})

check("domainOf strips www and handles junk", () => {
  assert.strictEqual(domainOf("https://www.sca.coffee/x"), "sca.coffee")
  assert.strictEqual(domainOf("not a url"), "")
})

console.log(`\n${passed} checks passed`)
