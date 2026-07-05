/**
 * Empirical latency + validity test for NIM model candidates on the ACTUAL
 * classify.ts task shape (a real bottleneck: classification runs once per
 * unique source, so its latency dominates wall-clock). Not guessing from specs.
 * Run: node --env-file=.env tests/_model_latency.ts
 */
const NIM_BASE = "https://integrate.api.nvidia.com/v1"
const KEY = process.env.NVIDIA_NIM_API_KEY

const CANDIDATES = [
  "qwen/qwen3-next-80b-a3b-instruct",       // current
  "nvidia/nemotron-3-nano-30b-a3b",          // small NVIDIA MoE
  "mistralai/ministral-14b-instruct-2512",   // small dense Mistral
  "stepfun-ai/step-3.5-flash",               // "flash" branded
  "openai/gpt-oss-120b",                     // flagged unresponsive in models.ts comment, retest
]

const INSTRUCTIONS = [
  "You classify a single web search result into exactly one source-type category for a competitive-intelligence completeness audit.",
  "Classify by the KIND of site, who publishes it, NOT by the topic it covers.",
  'Return ONLY compact JSON shaped like {"category": string, "confidence": "high" | "low", "justification": string}.',
  "category MUST be exactly one of: trade_pub, regional_press, mainstream_press, forum, manufacturer, retailer, vendor_blog, other",
].join("\n")

const PROMPT = [
  "URL: https://geekhack.org/index.php?topic=114871.0",
  "Title: Best and worst switch manufacturers/brands? - Geekhack",
  "Description: Geekhack forum thread discussing mechanical keyboard switch brands.",
].join("\n")

function parseJsonObject(text: string) {
  const trimmed = text.trim()
  const jsonText = trimmed.startsWith("{") ? trimmed : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "")
  if (!jsonText) return undefined
  try { return JSON.parse(jsonText) } catch { return undefined }
}

async function testModel(model: string): Promise<void> {
  const started = Date.now()
  try {
    const res = await fetch(`${NIM_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: INSTRUCTIONS },
          { role: "user", content: PROMPT },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const ms = Date.now() - started
    if (!res.ok) {
      console.log(`${model.padEnd(38)} FAILED  ${ms}ms  HTTP ${res.status}`)
      return
    }
    const json = await res.json() as { choices?: { message?: { content?: string } }[] }
    const text = json.choices?.[0]?.message?.content ?? ""
    const parsed = parseJsonObject(text) as { category?: string; confidence?: string } | undefined
    const valid = parsed?.category === "forum"
    console.log(`${model.padEnd(38)} ${valid ? "OK    " : "BAD   "}  ${ms}ms  -> ${JSON.stringify(parsed)}`)
  } catch (err) {
    const ms = Date.now() - started
    console.log(`${model.padEnd(38)} TIMEOUT ${ms}ms  ${(err as Error).message}`)
  }
}

async function main() {
  for (const model of CANDIDATES) {
    await testModel(model)
  }
}
main()
