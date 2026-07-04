import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  toUIMessageStream,
  type UIMessageStreamWriter,
} from "ai"
import { z } from "zod"

import { SourceSchema } from "@/lib/ai/citations"
import {
  FRESHNESS_POLICY_MAX_AGE_MS,
  filterExcludedSources,
  firecrawlScrapeSource,
  firecrawlSearch,
  getCiteableSources,
  type FreshnessPolicy,
  type SearchResultSource,
} from "@/lib/ai/firecrawl"
import { ModelIdSchema, type ModelId } from "@/lib/ai/models"
import {
  getLanguageModel,
  getMissingApiKey,
  getProviderOptions,
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
  freshnessPolicy,
  onProgress,
  sources,
}: {
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

  await Promise.all(
    sources.map(async (source, index) => {
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
    })
  )

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

function streamResponse({
  result,
  tool,
}: {
  result: ReturnType<typeof streamText>
  tool?: {
    input: unknown
    output: unknown
    toolCallId: string
    toolName: string
  }
}) {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      if (tool) {
        writeToolResult({
          ...tool,
          writer,
        })
      }

      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendReasoning: true,
        })
      )
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

  try {
    const hasContext = messages.length > 1 || citeablePreviousSources.length > 0
    const initialSearchDecision = getSearchIntentDecision(query)

    if (initialSearchDecision === "direct") {
      return streamResponse({
        result: answerDirectly({
          currentDateContext,
          messages,
          modelId,
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
          const result = answerFromContext({
            currentDateContext,
            messages,
            modelId,
            query,
            sources: citeablePreviousSources,
          })

          return streamResponse({
            result,
            tool: {
              input: { query },
              output: { query, sources: citeablePreviousSources },
              toolCallId: crypto.randomUUID(),
              toolName: "context",
            },
          })
        }

        return streamResponse({
          result: answerDirectly({
            currentDateContext,
            messages,
            modelId,
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
          result: answerDirectly({
            currentDateContext,
            messages,
            modelId,
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

        const result = answerWithSearch({
          currentDateContext,
          modelId,
          query,
          searchQuery,
          sources: citeableSources,
        })

        writer.merge(
          toUIMessageStream({
            stream: result.stream,
            sendReasoning: true,
          })
        )
      } catch (error) {
        writeToolError({
          error,
          toolCallId: searchToolCallId,
          writer,
        })
        throw error
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}
