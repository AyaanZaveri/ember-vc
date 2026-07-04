import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { google } from "@ai-sdk/google"

import {
  DEFAULT_MODEL_ID,
  getModelProvider,
  type ModelId,
} from "@/lib/ai/models"

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
