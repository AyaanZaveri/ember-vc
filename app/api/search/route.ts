import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  type UIMessageStreamWriter,
} from "ai"
import { z } from "zod"

import { SourceSchema } from "@/lib/ai/citations"
import {
  applyRanking,
  buildShortlist,
  type ConsensusSource,
  extractResearchEntities,
  mergeSearchResultsByConsensus,
  planDeepResearch,
  rankShortlist,
} from "@/lib/ai/deep-research"
import {
  FRESHNESS_POLICY_MAX_AGE_MS,
  filterExcludedSources,
  firecrawlScrapeSource,
  firecrawlSearch,
  getCiteableSources,
  type FreshnessPolicy,
  type SearchResultSource,
} from "@/lib/ai/firecrawl"
import { DEFAULT_MODEL_ID, ModelIdSchema, type ModelId } from "@/lib/ai/models"
import {
  ANSWER_CALL_TIMEOUT_MS,
  getLanguageModel,
  getMissingApiKey,
  getProviderOptions,
  MODEL_CALL_TIMEOUT_MS,
  SEARCH_MODEL_ID,
} from "@/lib/ai/provider"
import { getCurrentRequestContext } from "@/lib/ai/request-context"
import { getSearchIntentDecision } from "@/lib/ai/search-intent"

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  parts: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
})

const requestSchema = z.object({
  currentDateContext: z.string().trim().max(500).optional(),
  query: z.string().trim().min(1, "Query is required."),
  messages: z.array(messageSchema).optional(),
  mode: z.enum(["search", "deepResearch"]).optional().default("search"),
  modelId: ModelIdSchema.optional(),
  sources: z.array(SourceSchema).optional(),
})

const FreshnessPolicySchema = z.enum([
  "live",
  "veryFresh",
  "fresh",
  "normal",
  "cached",
])

const searchPlanSchema = z.object({
  freshnessPolicy: FreshnessPolicySchema.optional(),
  shouldSearch: z.boolean(),
  rewrittenQuery: z.string().optional(),
})

const initialSearchPlanSchema = z.object({
  freshnessPolicy: FreshnessPolicySchema.optional(),
  performSearch: z.boolean(),
  query: z.string().optional(),
})

const freshnessPolicyDecisionSchema = z.object({
  freshnessPolicy: FreshnessPolicySchema,
})

const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = "normal"

// Deep Research runs several planning/extraction calls before the answer, so it
// uses a fast model for those (the big default model can take 30-50s per call on
// NIM). The final answer still uses the user-selected model. A non-reasoning
// *instruct* model is used deliberately: these calls demand enum-constrained
// JSON, and reasoning models (Nemotron Nano, gpt-oss) either hallucinate invalid
// enum values or blow their token budget on thinking and return empty content.
// gpt-oss-20b was the original pick but is currently down on NIM entirely.
const DEEP_RESEARCH_HELPER_MODEL_ID: ModelId = "qwen/qwen3-next-80b-a3b-instruct"

const citationStyleInstructions = [
  "Cite factual claims with simple source markers like [1] or [2].",
  "Place citation markers at the END of a complete sentence, after the claim they support.",
  "Never use a citation marker as a grammatical part of a sentence. Do not write things like '[1] says...', '[2] lists...', or '[3] confirms...'.",
  "If you need to mention who says something, name the source in prose first, then put the citation at the end, e.g. 'Wisden lists Shoaib Akhtar at 161.3 km/h. [1]'",
  "Do not insert citation markers mid-sentence, between a subject and verb, or before punctuation that continues the same sentence.",
  "For multiple citations, write adjacent markers with no commas, spaces, or ranges: write [2][5], NEVER [2, 5], [2,5], [2 5], or [2-5].",
]

function dedupeSources(sources: SearchResultSource[]) {
  const seen = new Set<string>()

  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false
    }

    seen.add(source.url)
    return true
  })
}

function formatSourcesForPrompt(sources: SearchResultSource[]) {
  return sources
    .map((source, index) =>
      [
        `[${index + 1}] ${source.title}`,
        `URL: ${source.url}`,
        `Description: ${source.description}`,
        source.readStatus ? `Read status: ${source.readStatus}` : undefined,
        "Markdown:",
        source.snippet,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n")
}

function getElapsedSeconds(start: number) {
  return Number(((performance.now() - start) / 1000).toFixed(2))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function scrapeSourcesInParallel({
  // Firecrawl throttles/times out (408s) once too many scrapes run
  // concurrently on one API key — 5 is the level the default single-search
  // path already runs at safely, so batch anything larger down to it.
  concurrency = 5,
  freshnessPolicy,
  onProgress,
  sources,
}: {
  concurrency?: number
  freshnessPolicy: FreshnessPolicy
  onProgress?: (sources: SearchResultSource[]) => void
  sources: SearchResultSource[]
}) {
  const scrapeStartedAt = performance.now()
  const maxAge = FRESHNESS_POLICY_MAX_AGE_MS[freshnessPolicy]
  const failures: { error: string; url: string }[] = []
  const enrichedSources: SearchResultSource[] = sources.map((source) => ({
    ...source,
    readStatus: "reading" as const,
  }))

  onProgress?.(enrichedSources)

  const scrapeOne = async (source: SearchResultSource, index: number) => {
    const sourceStartedAt = performance.now()

    try {
      const scrapedSource = await firecrawlScrapeSource({ maxAge, source })
      const durationSeconds = getElapsedSeconds(sourceStartedAt)

      enrichedSources[index] = {
        ...source,
        ...scrapedSource,
        readSeconds: durationSeconds,
        readStatus: "complete",
      }

      console.info("[search] scraped source", {
        durationSeconds,
        freshnessPolicy,
        maxAge,
        url: source.url,
      })
    } catch (error) {
      const durationSeconds = getElapsedSeconds(sourceStartedAt)
      const errorMessage = getErrorMessage(error)

      failures.push({
        error: errorMessage,
        url: source.url,
      })

      enrichedSources[index] = {
        ...source,
        readError: errorMessage,
        readSeconds: durationSeconds,
        readStatus: "error",
      }

      console.warn("[search] source scrape failed", {
        durationSeconds,
        error: errorMessage,
        freshnessPolicy,
        maxAge,
        url: source.url,
      })
    }

    onProgress?.([...enrichedSources])
  }

  for (let start = 0; start < sources.length; start += concurrency) {
    await Promise.all(
      sources
        .slice(start, start + concurrency)
        .map((source, offset) => scrapeOne(source, start + offset))
    )
  }

  return {
    durationSeconds: getElapsedSeconds(scrapeStartedAt),
    failures,
    sources: enrichedSources,
  }
}

function formatConversation(messages: z.infer<typeof messageSchema>[]) {
  return messages
    .map((message) => {
      const text = message.parts
        .map((part) => part.text)
        .join("\n")
        .trim()

      return text ? `${message.role}: ${text}` : null
    })
    .filter((line): line is string => line !== null)
    .slice(-8)
    .join("\n\n")
}

function getMessageText(message: z.infer<typeof messageSchema>) {
  return message.parts
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function getRecentConversationContext({
  messages,
  query,
  limit = 6,
}: {
  messages: z.infer<typeof messageSchema>[]
  query: string
  limit?: number
}) {
  return getHistoryMessages({ messages, query }).slice(-limit)
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

function isLikelyContextFollowUp(query: string) {
  return /^(who|who'?s|what|when|where|which|why|how|against|their|its?|that|this|are you sure|is that right|really|source|cite|verify|check)\b/i.test(
    query.trim()
  )
}

const freshnessPolicyInstructions = [
  "Choose freshnessPolicy by reasoning about whether the answer is expected to change over time.",
  "- live: the user needs the state at this exact moment, and stale data would likely be wrong.",
  "- veryFresh: the answer can change within minutes, but the user did not explicitly require exact live state.",
  "- fresh: the answer can change within hours or days, or the user asks about current/recent/latest/future status.",
  "- normal: the answer can change occasionally, but a cache up to a couple days old is acceptable.",
  "- cached: the answer is a stable historical/reference fact, or the user is asking about an already-established fact whose value should not change.",
  "Prefer cached for stable one-time facts, even if the query asks for a date.",
  "Prefer fresh or veryFresh for scheduled future/current events, mutable listings, availability, rankings, prices, scores, and status.",
  "Do not keyword-match mechanically. Use the actual semantics of the user request.",
]

function getHistoryMessages({
  messages,
  query,
}: {
  messages: z.infer<typeof messageSchema>[]
  query: string
}) {
  const queryText = query.trim()
  const history = [...messages]

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]

    if (message.role === "user" && getMessageText(message) === queryText) {
      history.splice(index, 1)
      break
    }
  }

  return history
}

function rewriteFollowUpQuery({
  messages,
  query,
}: {
  messages: z.infer<typeof messageSchema>[]
  query: string
}) {
  const recentContext = getRecentConversationContext({
    messages,
    query,
    limit: 4,
  })
    .map(getMessageText)
    .filter(Boolean)

  return [...recentContext, query]
    .filter(Boolean)
    .join(" ")
}

async function planSearch({
  currentDateContext,
  messages,
  modelId,
  query,
  sources,
}: {
  currentDateContext: string
  messages: z.infer<typeof messageSchema>[]
  modelId: ModelId
  query: string
  sources: SearchResultSource[]
}) {
  const historyMessages = getHistoryMessages({ messages, query })

  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0,
      instructions: [
        "You decide whether a user follow-up needs a new web search.",
        'Return ONLY compact JSON shaped like {"shouldSearch": boolean, "rewrittenQuery": string | undefined, "freshnessPolicy": "live" | "veryFresh" | "fresh" | "normal" | "cached" | undefined}.',
        "Use the conversation and previous source snippets first.",
        "Respect explicit user instructions about searching. If the user clearly asks to search, set shouldSearch to true. If the user clearly says not to search, set shouldSearch to false.",
        "Set shouldSearch to false when the answer is explicitly provided by request context, unless the user explicitly asks to search anyway.",
        "If the previous source snippets contain enough evidence, set shouldSearch to false.",
        "If a new search is needed, rewrite the query with the missing context from the conversation.",
        "For challenge or verification follow-ups like 'are you sure?', 'really?', 'source?', or 'is that right?', search unless previous sources already prove the answer.",
        "Never search a bare follow-up literally, such as 'are you sure?', 'against who?', or 'what time?'.",
        "When rewriting a bare follow-up, include the last concrete subject, entity, and factual claim from the conversation.",
        ...freshnessPolicyInstructions,
      ].join("\n"),
      prompt: [
        `Current user question: ${query}`,
        `Request context:\n${currentDateContext}`,
        "",
        historyMessages.length > 0
          ? `Conversation before current question:\n${formatConversation(historyMessages)}`
          : "Conversation: none",
        "",
        sources.length > 0
          ? `Previous sources:\n\n${formatSourcesForPrompt(sources)}`
          : "Previous sources: none",
      ].join("\n"),
      providerOptions: getProviderOptions(modelId),
    })
    const parsed = searchPlanSchema.safeParse(parseJsonObject(result.text))

    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // Fall through to the deterministic fallback below.
  }

  if (sources.length > 0 && isLikelyContextFollowUp(query)) {
    return { shouldSearch: false }
  }

  return {
    shouldSearch: true,
    rewrittenQuery: rewriteFollowUpQuery({ messages, query }) || query,
  }
}

async function planInitialSearch({
  currentDateContext,
  modelId,
  query,
}: {
  currentDateContext: string
  modelId: ModelId
  query: string
}) {
  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0.7,
      instructions: [
        "Decide semantically whether the user request needs web search before answering.",
        'Return ONLY compact JSON shaped like {"performSearch": boolean, "query": string | undefined, "freshnessPolicy": "live" | "veryFresh" | "fresh" | "normal" | "cached" | undefined}.',
        "Use the request context and conversation first.",
        "Search only when the user asks for search/web evidence or the answer depends on information outside the provided context.",
        "Respect the user's explicit search or no-search instruction.",
        "When performSearch is true, write query as one concise web search query with the important named entities and missing context.",
        ...freshnessPolicyInstructions,
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        `User request: ${query}`,
      ].join("\n"),
      providerOptions: getProviderOptions(modelId),
    })
    const parsed = initialSearchPlanSchema.safeParse(
      parseJsonObject(result.text)
    )

    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // Fall through to the conservative fallback below.
  }

  return { performSearch: true, query }
}

async function rewriteSearchQueries({
  currentDateContext,
  messages = [],
  modelId,
  query,
}: {
  currentDateContext: string
  messages?: z.infer<typeof messageSchema>[]
  modelId: ModelId
  query: string
}) {
  const recentContext = getRecentConversationContext({
    messages,
    query,
  })

  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0,
      instructions: [
        "Rewrite the current user request as one concise web search query.",
        "Use the recent conversation to resolve short follow-ups, pronouns, omitted subjects, and phrases like 'what about X', 'and them?', or 'same for that one'.",
        "If the current request is already self-contained, keep it mostly unchanged.",
        "Do not answer the request.",
        "Do not broaden the scope beyond what the user asked.",
        "Return only the query text.",
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        recentContext.length > 0
          ? `Recent conversation before current request:\n${formatConversation(
              recentContext
            )}`
          : "Recent conversation before current request: none",
        "",
        `Current user request: ${query}`,
      ].join("\n"),
      providerOptions: getProviderOptions(modelId),
    })
    return result.text.trim() || query
  } catch {
    return rewriteFollowUpQuery({ messages, query }) || query
  }
}

async function decideFreshnessPolicy({
  currentDateContext,
  modelId,
  query,
  searchQuery,
}: {
  currentDateContext: string
  modelId: ModelId
  query: string
  searchQuery: string
}) {
  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
      temperature: 0,
      instructions: [
        "You decide how fresh Firecrawl scraped content must be for this web request.",
        'Return ONLY compact JSON shaped like {"freshnessPolicy": "live" | "veryFresh" | "fresh" | "normal" | "cached"}.',
        ...freshnessPolicyInstructions,
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        `User request: ${query}`,
        searchQuery !== query ? `Search query: ${searchQuery}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      providerOptions: getProviderOptions(modelId),
    })
    const parsed = freshnessPolicyDecisionSchema.safeParse(
      parseJsonObject(result.text)
    )

    if (parsed.success) {
      return parsed.data.freshnessPolicy
    }
  } catch {
    // Fall through to the conservative default below.
  }

  return DEFAULT_FRESHNESS_POLICY
}

function writeToolResult({
  input,
  output,
  toolCallId,
  toolName,
  writer,
}: {
  input: unknown
  output: unknown
  toolCallId: string
  toolName: string
  writer: UIMessageStreamWriter
}) {
  writeToolInput({
    input,
    toolCallId,
    toolName,
    writer,
  })
  writer.write({
    type: "tool-output-available",
    toolCallId,
    output,
  })
}

function writeToolInput({
  input,
  toolCallId,
  toolName,
  writer,
}: {
  input: unknown
  toolCallId: string
  toolName: string
  writer: UIMessageStreamWriter
}) {
  writer.write({
    type: "tool-input-available",
    toolCallId,
    toolName,
    input,
  })
}

function writeToolError({
  error,
  toolCallId,
  writer,
}: {
  error: unknown
  toolCallId: string
  writer: UIMessageStreamWriter
}) {
  writer.write({
    type: "tool-output-error",
    toolCallId,
    errorText: error instanceof Error ? error.message : "Search failed.",
  })
}

// After a tool step has failed we've already surfaced the error to the UI.
// Re-throwing out of the stream `execute` only produces a second, stream-level
// error part the client has to reconcile — instead, close out the turn with a
// visible assistant message so the run ends cleanly.
function writeFailureMessage(writer: UIMessageStreamWriter) {
  const id = crypto.randomUUID()
  writer.write({ type: "text-start", id })
  writer.write({
    type: "text-delta",
    id,
    delta:
      "Something went wrong while searching. The provider may be temporarily unavailable — please try again.",
  })
  writer.write({ type: "text-end", id })
}

function writeToolOutput({
  output,
  toolCallId,
  writer,
}: {
  output: unknown
  toolCallId: string
  writer: UIMessageStreamWriter
}) {
  writer.write({
    type: "tool-output-available",
    toolCallId,
    output,
  })
}

/**
 * Streams a model answer into the UI writer with a safety net. Model providers
 * (NIM especially) intermittently abort a stream with a 500 *before emitting any
 * token* — e.g. minimax-m3 does this on a large fraction of requests right now.
 * Left unhandled that surfaces as a silent empty assistant bubble: the activity
 * trail completes, then nothing. So: if the stream fails before any visible
 * text, retry — the same model first (most 500s are transient), then the
 * known-good default model. If every attempt fails, emit a visible error rather
 * than an empty message. Once real text has streamed we can't cleanly restart,
 * so we stop and keep whatever was shown.
 */
async function streamAnswerWithFallback({
  buildAnswer,
  modelId,
  writer,
}: {
  buildAnswer: (modelId: ModelId) => ReturnType<typeof streamText>
  modelId: ModelId
  writer: UIMessageStreamWriter
}) {
  const attempts: ModelId[] =
    modelId === DEFAULT_MODEL_ID
      ? [modelId, modelId]
      : [modelId, modelId, DEFAULT_MODEL_ID]
  let sawText = false

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const attemptModelId = attempts[attempt]

    try {
      for await (const part of buildAnswer(attemptModelId).fullStream) {
        switch (part.type) {
          case "text-start":
            sawText = true
            writer.write({ type: "text-start", id: part.id })
            break
          case "text-delta":
            sawText = true
            writer.write({ type: "text-delta", id: part.id, delta: part.text })
            break
          case "text-end":
            writer.write({ type: "text-end", id: part.id })
            break
          case "reasoning-start":
            writer.write({ type: "reasoning-start", id: part.id })
            break
          case "reasoning-delta":
            writer.write({
              type: "reasoning-delta",
              id: part.id,
              delta: part.text,
            })
            break
          case "reasoning-end":
            writer.write({ type: "reasoning-end", id: part.id })
            break
          case "error":
            throw part.error
        }
      }

      return
    } catch (error) {
      const message = getErrorMessage(error)

      // Text already reached the user — a retry would duplicate output, so keep
      // the partial answer rather than restart.
      if (sawText) {
        console.warn("[search] answer stream failed after partial output", {
          attemptModelId,
          error: message,
        })
        return
      }

      console.warn("[search] answer stream failed before output, retrying", {
        attempt,
        attemptModelId,
        nextModelId: attempts[attempt + 1],
        error: message,
      })
    }
  }

  const id = crypto.randomUUID()
  writer.write({ type: "text-start", id })
  writer.write({
    type: "text-delta",
    id,
    delta:
      "The model provider returned an error before producing a response. The selected model may be temporarily unavailable — please try again or switch models.",
  })
  writer.write({ type: "text-end", id })
}

function streamResponse({
  buildAnswer,
  modelId,
  tool,
}: {
  buildAnswer: (modelId: ModelId) => ReturnType<typeof streamText>
  modelId: ModelId
  tool?: {
    input: unknown
    output: unknown
    toolCallId: string
    toolName: string
  }
}) {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      if (tool) {
        writeToolResult({
          ...tool,
          writer,
        })
      }

      await streamAnswerWithFallback({ buildAnswer, modelId, writer })
    },
  })

  return createUIMessageStreamResponse({ stream })
}

function answerFromContext({
  currentDateContext,
  messages,
  modelId,
  query,
  sources,
}: {
  currentDateContext: string
  messages: z.infer<typeof messageSchema>[]
  modelId: ModelId
  query: string
  sources: SearchResultSource[]
}) {
  return streamText({
    model: getLanguageModel(modelId),
    abortSignal: AbortSignal.timeout(ANSWER_CALL_TIMEOUT_MS),
    temperature: 0.2,
    instructions: [
      "You are Ember, a concise research assistant.",
      "Answer the user's follow-up using only the provided conversation and previous source snippets.",
      "Cite every factual claim that comes from the sources.",
      ...citationStyleInstructions,
      "Only use citation numbers that appear in the provided previous sources.",
      "If the previous sources do not contain enough evidence, say that the available context is insufficient.",
      "Do not claim that you performed a new web search.",
    ].join("\n"),
    prompt: [
      `Request context:\n${currentDateContext}`,
      "",
      `Current user question: ${query}`,
      "",
      messages.length > 0
        ? `Conversation:\n${formatConversation(messages)}`
        : "Conversation: none",
      "",
      `Previous sources:\n\n${formatSourcesForPrompt(sources)}`,
    ].join("\n"),
    providerOptions: getProviderOptions(modelId),
  })
}

function answerDirectly({
  currentDateContext,
  messages,
  modelId,
  query,
}: {
  currentDateContext: string
  messages: z.infer<typeof messageSchema>[]
  modelId: ModelId
  query: string
}) {
  return streamText({
    model: getLanguageModel(modelId),
    abortSignal: AbortSignal.timeout(ANSWER_CALL_TIMEOUT_MS),
    temperature: 0.2,
    instructions: [
      "You are Ember, a concise and helpful assistant.",
      "Answer directly from general knowledge.",
      "Use the request context whenever it directly answers the user's question.",
      "If the answer is explicitly provided in request context, answer from that context without web search.",
      "If the user prohibited search and the answer requires a current external fact not present in request context or conversation, say you cannot verify it without search.",
      "Do not claim to have searched the web.",
      "Do not include citations because no sources were retrieved.",
    ].join("\n"),
    prompt: [
      `Request context:\n${currentDateContext}`,
      messages.length > 0
        ? `Conversation:\n${formatConversation(messages)}`
        : "",
      `User question: ${query}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    providerOptions: getProviderOptions(modelId),
  })
}

function answerWithSearch({
  currentDateContext,
  modelId,
  query,
  searchQuery,
  sources,
}: {
  currentDateContext: string
  modelId: ModelId
  query: string
  searchQuery: string
  sources: SearchResultSource[]
}) {
  return streamText({
    model: getLanguageModel(modelId),
    abortSignal: AbortSignal.timeout(ANSWER_CALL_TIMEOUT_MS),
    temperature: 0.2,
    instructions: [
      "You are Ember, a concise research assistant.",
      "Base your answer only on the provided Firecrawl search results.",
      "Use the markdown content from the top search results as evidence.",
      "Write a direct answer in markdown. Keep it brief unless the user asks for detail.",
      ...citationStyleInstructions,
      "Only use citation numbers that appear in the provided search results.",
      "If the evidence is thin or conflicting, say that clearly.",
    ].join("\n"),
    prompt: [
      `Request context:\n${currentDateContext}`,
      `User question: ${query}`,
      searchQuery !== query ? `Search query: ${searchQuery}` : "",
      "",
      sources.length > 0
        ? `Search results:\n\n${formatSourcesForPrompt(sources)}`
        : "Search results: none",
    ]
      .filter(Boolean)
      .join("\n"),
    providerOptions: getProviderOptions(modelId),
  })
}

export async function POST(request: Request) {
  const parsedBody = requestSchema.safeParse(await request.json())

  if (!parsedBody.success) {
    return Response.json(
      {
        error:
          parsedBody.error.flatten().fieldErrors.query?.[0] ??
          "Invalid request.",
      },
      { status: 400 }
    )
  }

  const query = parsedBody.data.query
  const currentDateContext =
    parsedBody.data.currentDateContext ?? getCurrentRequestContext()
  const messages = parsedBody.data.messages ?? []
  const modelId = parsedBody.data.modelId ?? SEARCH_MODEL_ID
  const plannerModelId = SEARCH_MODEL_ID
  const previousSources = filterExcludedSources(
    dedupeSources(parsedBody.data.sources ?? [])
  ).slice(0, 8)
  const citeablePreviousSources = getCiteableSources(previousSources).slice(
    0,
    8
  )
  const missingApiKey = getMissingApiKey(modelId)
  const missingPlannerApiKey = getMissingApiKey(plannerModelId)

  if (missingApiKey) {
    return Response.json(
      { error: `${missingApiKey} is not configured.` },
      { status: 500 }
    )
  }

  if (missingPlannerApiKey) {
    return Response.json(
      { error: `${missingPlannerApiKey} is not configured.` },
      { status: 500 }
    )
  }

  if (parsedBody.data.mode === "deepResearch") {
    return handleDeepResearch({
      currentDateContext,
      modelId,
      query,
    })
  }

  try {
    const hasContext = messages.length > 1 || citeablePreviousSources.length > 0
    const initialSearchDecision = getSearchIntentDecision(query)

    if (initialSearchDecision === "direct") {
      return streamResponse({
        modelId,
        buildAnswer: (answerModelId) =>
          answerDirectly({
            currentDateContext,
            messages,
            modelId: answerModelId,
            query,
          }),
      })
    }

    if (hasContext) {
      const plan = await planSearch({
        currentDateContext,
        messages,
        modelId: plannerModelId,
        query,
        sources: citeablePreviousSources,
      })

      if (!plan.shouldSearch) {
        if (citeablePreviousSources.length > 0) {
          return streamResponse({
            modelId,
            buildAnswer: (answerModelId) =>
              answerFromContext({
                currentDateContext,
                messages,
                modelId: answerModelId,
                query,
                sources: citeablePreviousSources,
              }),
            tool: {
              input: { query },
              output: { query, sources: citeablePreviousSources },
              toolCallId: crypto.randomUUID(),
              toolName: "context",
            },
          })
        }

        return streamResponse({
          modelId,
          buildAnswer: (answerModelId) =>
            answerDirectly({
              currentDateContext,
              messages,
              modelId: answerModelId,
              query,
            }),
        })
      }

      return handleSearchWithRewrite({
        currentDateContext,
        freshnessPolicy: plan.freshnessPolicy,
        messages,
        modelId,
        plannerModelId,
        query,
        rewriteQuery: plan.rewrittenQuery?.trim() || query,
        searchQuery: plan.rewrittenQuery?.trim() || query,
      })
    }

    if (initialSearchDecision === "classify") {
      const plan = await planInitialSearch({
        currentDateContext,
        modelId: plannerModelId,
        query,
      })

      if (!plan.performSearch) {
        return streamResponse({
          modelId,
          buildAnswer: (answerModelId) =>
            answerDirectly({
              currentDateContext,
              messages,
              modelId: answerModelId,
              query,
            }),
        })
      }

      return handleSearchWithRewrite({
        currentDateContext,
        freshnessPolicy: plan.freshnessPolicy,
        messages,
        modelId,
        plannerModelId,
        query,
        rewriteQuery: plan.query?.trim() || query,
        searchQuery: plan.query?.trim() || undefined,
      })
    }

    return handleSearchWithRewrite({
      currentDateContext,
      messages,
      modelId,
      plannerModelId,
      query,
      searchQuery: query,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Search request failed."

    return Response.json({ error: message }, { status: 500 })
  }
}

function handleSearchWithRewrite({
  currentDateContext,
  freshnessPolicy,
  messages = [],
  modelId,
  plannerModelId,
  query,
  rewriteQuery,
  searchQuery: preparedSearchQuery,
}: {
  currentDateContext: string
  freshnessPolicy?: FreshnessPolicy
  messages?: z.infer<typeof messageSchema>[]
  modelId: ModelId
  plannerModelId: ModelId
  query: string
  rewriteQuery?: string
  searchQuery?: string
}) {
  if (!process.env.FIRECRAWL_API_KEY) {
    return Response.json(
      { error: "FIRECRAWL_API_KEY is not configured." },
      { status: 500 }
    )
  }

  const queryToolCallId = crypto.randomUUID()
  const searchToolCallId = crypto.randomUUID()
  const queryToRewrite = rewriteQuery ?? query
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const requestStartedAt = performance.now()

      writeToolInput({
        input: { query: queryToRewrite },
        toolCallId: queryToolCallId,
        toolName: "query",
        writer,
      })

      try {
        const rewriteStartedAt = performance.now()
        const searchQuery =
          preparedSearchQuery ??
          (await rewriteSearchQueries({
            currentDateContext,
            messages,
            modelId: plannerModelId,
            query: queryToRewrite,
          }))
        const resolvedFreshnessPolicy =
          freshnessPolicy ??
          (await decideFreshnessPolicy({
            currentDateContext,
            modelId: plannerModelId,
            query,
            searchQuery,
          }))
        const maxAge = FRESHNESS_POLICY_MAX_AGE_MS[resolvedFreshnessPolicy]
        const rewriteDurationSeconds = getElapsedSeconds(rewriteStartedAt)

        console.info("[search] query ready", {
          durationSeconds: rewriteDurationSeconds,
          freshnessPolicy: resolvedFreshnessPolicy,
          maxAge,
          prepared: Boolean(preparedSearchQuery),
        })

        writeToolOutput({
          output: {
            freshnessPolicy: resolvedFreshnessPolicy,
            maxAge,
            query: searchQuery,
            searches: [searchQuery],
            timings: {
              rewriteSeconds: rewriteDurationSeconds,
            },
          },
          toolCallId: queryToolCallId,
          writer,
        })

        writeToolInput({
          input: {
            freshnessPolicy: resolvedFreshnessPolicy,
            maxAge,
            query: searchQuery,
            searches: [searchQuery],
          },
          toolCallId: searchToolCallId,
          toolName: "search",
          writer,
        })

        const searchStartedAt = performance.now()
        const searchResult = await firecrawlSearch({
          query: searchQuery,
          limit: 5,
          maxAge,
          scrapeContent: false,
        })
        const sources = dedupeSources(searchResult.sources)
          .slice(0, 5)
          .map((source) => ({
            ...source,
            readStatus: "reading" as const,
          }))
        const searchDurationSeconds = getElapsedSeconds(searchStartedAt)

        console.info("[search] url search complete", {
          durationSeconds: searchDurationSeconds,
          freshnessPolicy: resolvedFreshnessPolicy,
          maxAge,
          sourceCount: sources.length,
        })

        writeToolOutput({
          output: {
            freshnessPolicy: resolvedFreshnessPolicy,
            maxAge,
            query: searchQuery,
            searches: [searchQuery],
            sources,
            status: "scraping",
            timings: {
              rewriteSeconds: rewriteDurationSeconds,
              searchSeconds: searchDurationSeconds,
              totalSeconds: getElapsedSeconds(requestStartedAt),
            },
            warning: searchResult.warning,
          },
          toolCallId: searchToolCallId,
          writer,
        })

        const scrapeResult = await scrapeSourcesInParallel({
          freshnessPolicy: resolvedFreshnessPolicy,
          onProgress: (progressSources) => {
            writeToolOutput({
              output: {
                freshnessPolicy: resolvedFreshnessPolicy,
                maxAge,
                query: searchQuery,
                searches: [searchQuery],
                sources: progressSources,
                status: "scraping",
                timings: {
                  rewriteSeconds: rewriteDurationSeconds,
                  searchSeconds: searchDurationSeconds,
                  totalSeconds: getElapsedSeconds(requestStartedAt),
                },
                warning: searchResult.warning,
              },
              toolCallId: searchToolCallId,
              writer,
            })
          },
          sources,
        })
        const scrapeWarning =
          scrapeResult.failures.length > 0
            ? `${scrapeResult.failures.length} source${
                scrapeResult.failures.length === 1 ? "" : "s"
              } could not be fully scraped and will not be cited.`
            : undefined
        const warning = [searchResult.warning, scrapeWarning]
          .filter(Boolean)
          .join(" ")
        const enrichedSources = dedupeSources(scrapeResult.sources).slice(0, 5)
        const citeableSources = getCiteableSources(enrichedSources).slice(0, 5)

        console.info("[search] parallel scrape complete", {
          durationSeconds: scrapeResult.durationSeconds,
          failedSourceCount: scrapeResult.failures.length,
          freshnessPolicy: resolvedFreshnessPolicy,
          maxAge,
          sourceCount: enrichedSources.length,
          citeableSourceCount: citeableSources.length,
          totalSeconds: getElapsedSeconds(requestStartedAt),
        })

        writeToolOutput({
          output: {
            freshnessPolicy: resolvedFreshnessPolicy,
            maxAge,
            query: searchQuery,
            searches: [searchQuery],
            sources: citeableSources,
            status: "complete",
            timings: {
              rewriteSeconds: rewriteDurationSeconds,
              searchSeconds: searchDurationSeconds,
              scrapeSeconds: scrapeResult.durationSeconds,
              totalSeconds: getElapsedSeconds(requestStartedAt),
            },
            warning: warning || undefined,
          },
          toolCallId: searchToolCallId,
          writer,
        })

        await streamAnswerWithFallback({
          modelId,
          buildAnswer: (answerModelId) =>
            answerWithSearch({
              currentDateContext,
              modelId: answerModelId,
              query,
              searchQuery,
              sources: citeableSources,
            }),
          writer,
        })
      } catch (error) {
        writeToolError({
          error,
          toolCallId: searchToolCallId,
          writer,
        })
        writeFailureMessage(writer)
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}

/**
 * Deep Research: a bounded fan-out pipeline, not a loop. One planner call
 * produces a fixed set of query variants, all variants run once in parallel,
 * and one closed-form ranking call judges the fixed shortlist it's handed.
 * Nothing here reads its own output and decides to search again — see
 * lib/ai/deep-research.ts for why that boundary matters.
 */
function handleDeepResearch({
  currentDateContext,
  modelId,
  query,
}: {
  currentDateContext: string
  modelId: ModelId
  query: string
}) {
  if (!process.env.FIRECRAWL_API_KEY) {
    return Response.json(
      { error: "FIRECRAWL_API_KEY is not configured." },
      { status: 500 }
    )
  }

  const planToolCallId = crypto.randomUUID()
  const searchToolCallId = crypto.randomUUID()
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const requestStartedAt = performance.now()

      writeToolInput({
        input: { query },
        toolCallId: planToolCallId,
        toolName: "plan",
        writer,
      })

      try {
        const planStartedAt = performance.now()
        const plan = await planDeepResearch({
          currentDateContext,
          modelId: DEEP_RESEARCH_HELPER_MODEL_ID,
          query,
        })
        const resolvedFreshnessPolicy =
          plan.freshnessPolicy ?? DEFAULT_FRESHNESS_POLICY
        const maxAge = FRESHNESS_POLICY_MAX_AGE_MS[resolvedFreshnessPolicy]
        const planDurationSeconds = getElapsedSeconds(planStartedAt)

        console.info("[deep-research] plan ready", {
          durationSeconds: planDurationSeconds,
          intentLens: plan.intentLens,
          queryVariants: plan.queryVariants,
        })

        writeToolOutput({
          output: {
            excludeSourceTypes: plan.excludeSourceTypes,
            freshnessPolicy: resolvedFreshnessPolicy,
            intentLens: plan.intentLens,
            maxAge,
            query,
            searches: plan.queryVariants,
            timings: { planSeconds: planDurationSeconds },
          },
          toolCallId: planToolCallId,
          writer,
        })

        // Each probe is its own visible tool step: input written up-front so it
        // appears immediately as an active spinner, output written when it
        // resolves. Found sources go under `found` (NOT `sources`) so they show
        // as chips in the activity trail without polluting citation numbering —
        // only the final aggregate step below carries the `sources` key the
        // frontend maps [1],[2]… onto.
        const runProbe = async (probeQuery: string, limit: number) => {
          const probeToolCallId = crypto.randomUUID()
          writeToolInput({
            input: { query: probeQuery },
            toolCallId: probeToolCallId,
            toolName: "probe",
            writer,
          })

          try {
            const { sources } = await firecrawlSearch({
              query: probeQuery,
              limit,
              maxAge,
              scrapeContent: false,
            })
            writeToolOutput({
              output: { found: sources, query: probeQuery, status: "complete" },
              toolCallId: probeToolCallId,
              writer,
            })
            return sources
          } catch (error) {
            writeToolError({ error, toolCallId: probeToolCallId, writer })
            return [] as SearchResultSource[]
          }
        }

        // Round 1 — the planned query variants, all in parallel.
        const round1StartedAt = performance.now()
        const round1Lists = await Promise.all(
          plan.queryVariants.map((variant) => runProbe(variant, 10))
        )
        const round1Sources = round1Lists.flat()
        console.info("[deep-research] round 1 complete", {
          durationSeconds: getElapsedSeconds(round1StartedAt),
          sourceCount: round1Sources.length,
          variantCount: plan.queryVariants.length,
        })

        // Round 2 — niche probing: pull specific entities out of round-1 results
        // and search each one directly (what surfaces the source that covers the
        // product but never ranks for the generic topic query).
        const entities = await extractResearchEntities({
          currentDateContext,
          modelId: DEEP_RESEARCH_HELPER_MODEL_ID,
          query,
          sources: round1Sources,
        })
        const round2StartedAt = performance.now()
        const round2Lists = entities.length
          ? await Promise.all(entities.map((entity) => runProbe(entity, 8)))
          : []
        const round2Sources = round2Lists.flat()
        console.info("[deep-research] round 2 complete", {
          durationSeconds: getElapsedSeconds(round2StartedAt),
          entities,
          sourceCount: round2Sources.length,
        })

        const allQueries = [...plan.queryVariants, ...entities]
        const merged = mergeSearchResultsByConsensus({
          resultLists: [...round1Lists, ...round2Lists],
        })
        // Scrape only the strongest slice by consensus — discovery is wide, but
        // scraping every result would be slow and burn credits for little gain.
        const shortlist: ConsensusSource[] = buildShortlist(merged, 24).map(
          (source) => ({ ...source, readStatus: "reading" as const })
        )

        console.info("[deep-research] discovery complete", {
          mergedCount: merged.length,
          queryCount: allQueries.length,
          shortlistCount: shortlist.length,
        })

        writeToolInput({
          input: { query, searches: allQueries },
          toolCallId: searchToolCallId,
          toolName: "search",
          writer,
        })

        writeToolOutput({
          output: {
            freshnessPolicy: resolvedFreshnessPolicy,
            maxAge,
            query,
            searches: allQueries,
            sources: shortlist,
            status: "scraping",
            timings: {
              planSeconds: planDurationSeconds,
              totalSeconds: getElapsedSeconds(requestStartedAt),
            },
          },
          toolCallId: searchToolCallId,
          writer,
        })

        const scrapeResult = await scrapeSourcesInParallel({
          freshnessPolicy: resolvedFreshnessPolicy,
          onProgress: (progressSources) => {
            writeToolOutput({
              output: {
                freshnessPolicy: resolvedFreshnessPolicy,
                maxAge,
                query,
                searches: allQueries,
                sources: progressSources,
                status: "scraping",
                timings: {
                  planSeconds: planDurationSeconds,
                  totalSeconds: getElapsedSeconds(requestStartedAt),
                },
              },
              toolCallId: searchToolCallId,
              writer,
            })
          },
          sources: shortlist,
        })
        const scrapeWarning =
          scrapeResult.failures.length > 0
            ? `${scrapeResult.failures.length} source${
                scrapeResult.failures.length === 1 ? "" : "s"
              } could not be fully scraped and will not be cited.`
            : undefined
        // consensusCount survives the spread in scrapeSourcesInParallel even
        // though SearchResultSource doesn't declare it — safe to reassert here.
        const citeableSources = getCiteableSources(
          scrapeResult.sources
        ) as ConsensusSource[]

        const rankStartedAt = performance.now()
        const ranking = await rankShortlist({
          currentDateContext,
          excludeSourceTypes: plan.excludeSourceTypes,
          intentLens: plan.intentLens,
          query,
          shortlist: citeableSources,
        })
        const rankedSources = applyRanking(citeableSources, ranking).slice(0, 12)
        const rankDurationSeconds = getElapsedSeconds(rankStartedAt)

        console.info("[deep-research] rank complete", {
          citeableCount: citeableSources.length,
          durationSeconds: rankDurationSeconds,
          finalCount: rankedSources.length,
        })

        // Final aggregate step — the ONLY tool output carrying `sources`, so the
        // frontend maps citation numbers [1],[2]… onto exactly this ranked list.
        writeToolOutput({
          output: {
            freshnessPolicy: resolvedFreshnessPolicy,
            maxAge,
            query,
            searches: allQueries,
            sources: rankedSources,
            status: "complete",
            timings: {
              planSeconds: planDurationSeconds,
              scrapeSeconds: scrapeResult.durationSeconds,
              rankSeconds: rankDurationSeconds,
              totalSeconds: getElapsedSeconds(requestStartedAt),
            },
            warning: scrapeWarning,
          },
          toolCallId: searchToolCallId,
          writer,
        })

        await streamAnswerWithFallback({
          modelId,
          buildAnswer: (answerModelId) =>
            answerWithSearch({
              currentDateContext,
              modelId: answerModelId,
              query,
              searchQuery: query,
              sources: rankedSources,
            }),
          writer,
        })
      } catch (error) {
        writeToolError({
          error,
          toolCallId: searchToolCallId,
          writer,
        })
        writeFailureMessage(writer)
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}
