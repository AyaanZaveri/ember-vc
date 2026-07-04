import {
  createUIMessageStreamResponse,
  convertToModelMessages,
  generateText,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai"
import { FirecrawlTools } from "firecrawl-aisdk"
import { z } from "zod"

import { ModelIdSchema } from "@/lib/ai/models"
import {
  CHAT_MODEL_ID,
  SEARCH_MODEL_ID,
  getLanguageModel,
  getMissingApiKey,
  getProviderOptions,
} from "@/lib/ai/provider"
import { getCurrentRequestContext } from "@/lib/ai/request-context"

export const maxDuration = 300

const requestSchema = z.object({
  currentDateContext: z.string().trim().max(500).optional(),
  messages: z.array(z.unknown()).min(1),
  modelId: ModelIdSchema.optional(),
})

const toolUsePlanSchema = z.object({
  enableFirecrawl: z.boolean(),
})

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

function getMessageText(message: unknown) {
  if (!message || typeof message !== "object" || !("parts" in message)) {
    return ""
  }

  const parts = (message as { parts?: unknown }).parts

  if (!Array.isArray(parts)) {
    return ""
  }

  return parts
    .map((part) =>
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("\n")
    .trim()
}

function formatConversation(messages: unknown[]) {
  return messages
    .map((message) => {
      if (!message || typeof message !== "object" || !("role" in message)) {
        return null
      }

      const role = (message as { role?: unknown }).role
      const text = getMessageText(message)

      return typeof role === "string" && text ? `${role}: ${text}` : null
    })
    .filter((line): line is string => line !== null)
    .slice(-8)
    .join("\n\n")
}

async function shouldEnableFirecrawl({
  currentDateContext,
  messages,
}: {
  currentDateContext: string
  messages: unknown[]
}) {
  const latestUserMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message &&
        typeof message === "object" &&
        "role" in message &&
        (message as { role?: unknown }).role === "user"
    )

  try {
    const result = await generateText({
      model: getLanguageModel(SEARCH_MODEL_ID),
      temperature: 0.7,
      instructions: [
        "Decide semantically whether this response needs live web tools.",
        'Return ONLY compact JSON shaped like {"enableFirecrawl": boolean}.',
        "Use the request context and conversation first.",
        "Enable tools only when the user asks for search/web evidence or the answer depends on information outside the provided context.",
        "Respect the user's explicit search or no-search instruction.",
      ].join("\n"),
      prompt: [
        `Request context:\n${currentDateContext}`,
        "",
        `Conversation:\n${formatConversation(messages)}`,
        "",
        `Latest user message: ${latestUserMessage ? getMessageText(latestUserMessage) : ""}`,
      ].join("\n"),
      providerOptions: getProviderOptions(SEARCH_MODEL_ID),
    })
    const parsed = toolUsePlanSchema.safeParse(parseJsonObject(result.text))

    if (parsed.success) {
      return parsed.data.enableFirecrawl
    }
  } catch {
    // Fall through to the conservative default below.
  }

  return true
}

export async function POST(request: Request) {
  const parsedBody = requestSchema.safeParse(await request.json())

  if (!parsedBody.success) {
    return Response.json({ error: "Invalid chat request." }, { status: 400 })
  }

  const validatedMessages = await safeValidateUIMessages({
    messages: parsedBody.data.messages,
  })

  if (!validatedMessages.success) {
    return Response.json({ error: "Invalid chat messages." }, { status: 400 })
  }

  const modelId = parsedBody.data.modelId ?? CHAT_MODEL_ID
  const plannerModelId = SEARCH_MODEL_ID
  const currentDateContext =
    parsedBody.data.currentDateContext ?? getCurrentRequestContext()
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

  const enableFirecrawl = await shouldEnableFirecrawl({
    currentDateContext,
    messages: validatedMessages.data,
  })

  if (enableFirecrawl && !process.env.FIRECRAWL_API_KEY) {
    return Response.json(
      { error: "FIRECRAWL_API_KEY is not configured." },
      { status: 500 }
    )
  }

  const { systemPrompt: firecrawlSystemPrompt, ...firecrawlToolEntries } =
    enableFirecrawl
      ? FirecrawlTools({
          all: true,
          map: true,
          maxResponseTokens: 12000,
          scrape: {
            formats: ["markdown"],
            onlyMainContent: true,
          },
          search: {
            limit: 5,
          },
        })
      : { systemPrompt: "" }

  const firecrawlTools = Object.fromEntries(
    Object.entries(firecrawlToolEntries).filter(
      ([, tool]) => tool !== undefined
    )
  ) as ToolSet

  const result = streamText({
    model: getLanguageModel(modelId),
    instructions: [
      "You are Ember, a direct, witty, slightly snarky assistant.",
      "Talk like a smart uni student chatting between classes: casual, clear, and not overly polished.",
      "Use natural slang when it fits, but don't force it or sound like a TikTok comment section.",
      "Be honest when the user's idea is weak, flawed, overcomplicated, or just not it.",
      "Don't be mean for no reason. Roast the idea lightly if needed, not the person.",
      "When something is good, say so plainly without hyping it like a startup pitch deck.",
      "Avoid corporate-speak, fake enthusiasm, and long bullet-point essays unless the user asks for depth.",
      "Keep answers short by default. Go deeper only when the topic actually needs it.",
      "Match the user's energy: casual gets casual, serious gets serious, technical gets precise.",

      "Always format responses in Markdown when it improves readability.",
      "Always bold the most important answer, conclusion, recommendation, or direct response to the user's question.",
      "If the user asks a direct question, put the main answer in bold near the start of the response.",
      "Use headings, code blocks, lists, and tables when they make the answer clearer, but do not over-format simple replies.",
      `Request context:\n${currentDateContext}`,
      "Use the request context whenever it directly answers the user's question.",

      "You have access to Firecrawl tools for live web search, URL discovery, and page scraping.",
      "Use Firecrawl when the user asks for current information, asks you to inspect a URL, or would benefit from web evidence.",
      "If the user explicitly asks you to search, browse, cite, or look something up, use Firecrawl.",
      "Do not use Firecrawl when the user explicitly says not to search, browse, or look something up.",
      "Do not use Firecrawl for facts that are explicitly provided in request context unless the user explicitly asks you to search anyway.",
      "Use Firecrawl for current or real-world facts beyond the request context, even if they may appear in training data.",
      "Prefer search before scrape unless the user provides a specific URL.",
      "Before calling Firecrawl for a short follow-up, resolve the search query against recent conversation context.",
      "Never search a bare fragment literally when prior turns supply the subject, event, entity, or factual claim.",
      "Use the shortest search query that includes the missing context needed to retrieve the right evidence.",
      "When using web data from tools, you MUST cite your sources.",
      "Cite only sources that directly support the sentence or claim they appear after.",
      "Place citation markers at the END of a complete sentence, after the claim they support.",
      "Never use a citation marker as a grammatical part of a sentence. Do not write things like '[1] says...', '[2] lists...', or '[3] confirms...'.",
      "If you need to mention who says something, name the source in prose first, then put the citation at the end, e.g. 'Wisden lists Shoaib Akhtar at 161.3 km/h. [1]'",
      "Do not insert citation markers mid-sentence, between a subject and verb, or before punctuation that continues the same sentence.",
      "Do NOT cite every source you searched, scraped, or inspected. Unused research sources must remain uncited.",
      "CRITICAL: Citations MUST be formatted ONLY as [number] (e.g., [1], [2], or [1][3] for multiple citations) where the number corresponds to the 1-based index of the search result/source.",
      "For multiple citations, write adjacent markers with no commas, spaces, or ranges: write [2][5], NEVER [2, 5], [2,5], [2 5], or [2-5].",
      "NEVER use markdown links for citations (do not write [1](url)).",
      "NEVER use 【】 brackets, † symbols, or include the full URL inside the citation brackets (e.g., NEVER write 【1†url】).",
      "Do not use full-width citation brackets. Use ASCII square brackets only: [ and ].",
      "ONLY write [1], [2], [3] etc. as simple text markers in the response body.",
      "Answer in markdown when formatting improves clarity.",
      firecrawlSystemPrompt,
    ].join("\n"),
    messages: await convertToModelMessages(validatedMessages.data),
    tools: enableFirecrawl ? firecrawlTools : undefined,
    stopWhen: enableFirecrawl ? isStepCount(10) : undefined,
    providerOptions: getProviderOptions(modelId),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: true,
    }),
  })
}
