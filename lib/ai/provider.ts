import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { google } from "@ai-sdk/google"

import {
  DEFAULT_MODEL_ID,
  getModelProvider,
  type ModelId,
} from "./models.ts"

const nimApiKey = process.env.NVIDIA_NIM_API_KEY

export const nim = createOpenAICompatible({
  name: "nim",
  baseURL: "https://integrate.api.nvidia.com/v1",
  headers: {
    Authorization: `Bearer ${nimApiKey ?? ""}`,
  },
})

export function getMissingApiKey(modelId: ModelId) {
  const provider = getModelProvider(modelId)

  if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return "GOOGLE_GENERATIVE_AI_API_KEY"
  }

  if (provider === "nim" && !process.env.NVIDIA_NIM_API_KEY) {
    return "NVIDIA_NIM_API_KEY"
  }

  return null
}

export function getLanguageModel(modelId: ModelId) {
  return getModelProvider(modelId) === "google"
    ? google(modelId)
    : nim.chatModel(modelId)
}

function isNemotronModel(modelId: ModelId) {
  return modelId.startsWith("nvidia/nemotron-")
}

export function getProviderOptions(modelId: ModelId) {
  if (getModelProvider(modelId) !== "nim") {
    return undefined
  }

  if (isNemotronModel(modelId)) {
    return {
      nim: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    }
  }

  return {
    nim: {
      reasoningEffort: "low",
    },
  }
}

export const SEARCH_MODEL_ID = DEFAULT_MODEL_ID
export const CHAT_MODEL_ID = DEFAULT_MODEL_ID

// A dead or unreachable model endpoint keeps its TCP connection open and never
// errors, so a model call with no deadline hangs forever — which is exactly how
// Deep Research got stuck on "plan" with no logs. Cap every model call so an
// outage surfaces as a thrown error that hits the existing fallbacks instead.
export const MODEL_CALL_TIMEOUT_MS = 30_000
// The final answer is a genuine long-running stream (reasoning models like
// MiniMax can think for 30s+ before the first visible token), so it gets a
// looser deadline than the bounded planning/ranking helper calls.
export const ANSWER_CALL_TIMEOUT_MS = 90_000
