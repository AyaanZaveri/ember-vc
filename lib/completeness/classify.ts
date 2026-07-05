import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { z } from "zod"

import { COMPLETENESS_MODEL_ID } from "./model.ts"
import {
  type CategoryId,
  type CompletenessProfile,
  matchesProfile,
} from "./profile.ts"

/**
 * Source-type classifier. The model does ONE thing: pick the source type from
 * the client's taxonomy. Whether that type counts for the client is decided by
 * deterministic code (matchesProfile), never by the model — so the business call
 * is auditable and the model can't quietly redefine what "relevant" means.
 *
 * Uses generateText + zod parse (not generateObject) on purpose: ember's NIM
 * provider is unreliable with json-schema/tool mode, so the whole codebase asks
 * for compact JSON in the prompt and validates it after. We match that.
 */

// Non-reasoning instruct model, chosen for the same reason the rest of ember
// does: it returns constrained JSON reliably without burning its budget on
// hidden reasoning. gpt-oss-120b is unresponsive on NIM (see lib/ai/models.ts).
// See model.ts for the latency test that picked the default and how to override it.
const CLASSIFIER_MODEL_ID = COMPLETENESS_MODEL_ID
const MODEL_CALL_TIMEOUT_MS = 30_000

const nim = createOpenAICompatible({
  name: "nim",
  baseURL: "https://integrate.api.nvidia.com/v1",
  headers: {
    Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY ?? ""}`,
  },
})

export type ClassifiableSource = {
  url: string
  title: string
  description: string
}

export type Classification = {
  category: CategoryId
  matches: boolean
  confidence: "high" | "low"
  justification: string
  /** True when the model returned nothing usable and we fell back to "other". */
  parseFailed: boolean
}

function buildSchema(profile: CompletenessProfile) {
  const ids = profile.categories.map((category) => category.id) as [
    CategoryId,
    ...CategoryId[],
  ]

  return z.object({
    category: z.enum(ids),
    confidence: z.enum(["high", "low"]),
    justification: z.string(),
  })
}

function parseJsonObject(text: string) {
  const trimmed = text.trim()
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "")

  if (!jsonText) {
    return undefined
  }

  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    return undefined
  }
}

function buildInstructions(profile: CompletenessProfile) {
  return [
    "You classify a single web search result into exactly one source-type category for a competitive-intelligence completeness audit.",
    "Classify by the KIND of site — who publishes it — NOT by the topic it covers. A buying guide on a store's blog is a vendor_blog even if it reads like journalism.",
    'Return ONLY compact JSON shaped like {"category": string, "confidence": "high" | "low", "justification": string}.',
    "category MUST be exactly one of these ids:",
    ...profile.categories.map((c) => `- ${c.id}: ${c.description}`),
    "confidence: 'high' when the source type is unambiguous; 'low' when it is borderline between two categories.",
    "justification: one short sentence naming the signal you used (domain, URL path, or wording).",
  ].join("\n")
}

function buildPrompt(source: ClassifiableSource) {
  return [
    `URL: ${source.url}`,
    `Title: ${source.title}`,
    `Description: ${source.description || "(none)"}`,
  ].join("\n")
}

// Transient NIM timeouts (observed in practice) shouldn't count as the model
// being "wrong" — they're infra flakiness, and conflating the two would let a
// slow endpoint silently corrupt the eval's accuracy number. Retry transient
// failures once; only a genuine bad/unparseable answer falls back to "other".
const TRANSIENT_RETRY_ATTEMPTS = 2

function isTransientError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || /timed?\s?out|ECONNRESET|fetch failed/i.test(error.message))
  )
}

export async function classifySource({
  source,
  profile,
  modelId = CLASSIFIER_MODEL_ID,
}: {
  source: ClassifiableSource
  profile: CompletenessProfile
  modelId?: string
}): Promise<Classification & { retries: number }> {
  const schema = buildSchema(profile)

  const fallback: Classification = {
    category: "other",
    matches: matchesProfile("other", profile),
    confidence: "low",
    justification: "Model returned no usable classification.",
    parseFailed: true,
  }

  let lastError: unknown

  for (let attempt = 0; attempt < TRANSIENT_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await generateText({
        model: nim.chatModel(modelId),
        abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
        temperature: 0,
        instructions: buildInstructions(profile),
        prompt: buildPrompt(source),
        providerOptions: { nim: { reasoningEffort: "low" } },
      })

      const parsed = schema.safeParse(parseJsonObject(result.text))

      if (parsed.success) {
        return {
          category: parsed.data.category,
          matches: matchesProfile(parsed.data.category, profile),
          confidence: parsed.data.confidence,
          justification: parsed.data.justification,
          parseFailed: false,
          retries: attempt,
        }
      }

      // Valid response, just not parseable as our schema — not transient, don't retry.
      lastError = new Error("Response failed schema validation")
      break
    } catch (error) {
      lastError = error
      if (!isTransientError(error) || attempt === TRANSIENT_RETRY_ATTEMPTS - 1) {
        break
      }
      console.warn(
        `[classify] transient error for ${source.url}, retrying (attempt ${attempt + 1})`
      )
    }
  }

  console.warn(`[classify] call failed for ${source.url}`, lastError)
  return { ...fallback, retries: TRANSIENT_RETRY_ATTEMPTS }
}
