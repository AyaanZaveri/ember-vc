import { z } from "zod"

export const MODEL_OPTIONS = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    shortLabel: "GPT-OSS 120B",
    lab: "OpenAI",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/openai.svg",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    shortLabel: "GPT-OSS 20B",
    lab: "OpenAI",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/openai.svg",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    shortLabel: "2.5 Flash",
    lab: "Gemini",
    provider: "google",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini-color.svg",
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite",
    shortLabel: "3.1 Flash Lite",
    lab: "Gemini",
    provider: "google",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini-color.svg",
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    shortLabel: "3.5 Flash",
    lab: "Gemini",
    provider: "google",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini-color.svg",
  },
  {
    id: "stepfun-ai/step-3.5-flash",
    label: "Step 3.5 Flash",
    shortLabel: "Step 3.5 Flash",
    lab: "StepFun",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/stepfun-color.svg",
  },
  {
    id: "stepfun-ai/step-3.7-flash",
    label: "Step 3.7 Flash",
    shortLabel: "Step 3.7 Flash",
    lab: "StepFun",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/stepfun-color.svg",
  },
  {
    id: "minimaxai/minimax-m2.7",
    label: "MiniMax M2.7",
    shortLabel: "M2.7",
    lab: "MiniMax",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/minimax-color.svg",
  },
  {
    id: "minimaxai/minimax-m3",
    label: "MiniMax M3",
    shortLabel: "M3",
    lab: "MiniMax",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/minimax-color.svg",
  },
  {
    id: "mistralai/mistral-small-4-119b-2603",
    label: "Mistral Small 4 119B",
    shortLabel: "Small 4",
    lab: "Mistral",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/mistral-color.svg",
  },
  {
    id: "mistralai/ministral-14b-instruct-2512",
    label: "Ministral 3 14B Instruct",
    shortLabel: "Ministral 14B",
    lab: "Mistral",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/mistral-color.svg",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra 550B A55B",
    shortLabel: "Nemotron Ultra",
    lab: "NVIDIA",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super 120B A12B",
    shortLabel: "Nemotron Super",
    lab: "NVIDIA",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    label: "Nemotron 3 Nano Omni",
    shortLabel: "Nemotron Omni",
    lab: "NVIDIA",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg",
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b",
    label: "Nemotron 3 Nano 30B A3B",
    shortLabel: "Nemotron Nano 30B",
    lab: "NVIDIA",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg",
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct",
    label: "Qwen3 Next 80B A3B Instruct",
    shortLabel: "Qwen3 Next",
    lab: "Qwen",
    provider: "nim",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/qwen-color.svg",
  },
] as const

export const MODEL_LABS = [
  {
    name: "OpenAI",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/openai.svg",
  },
  {
    name: "StepFun",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/stepfun-color.svg",
  },
  {
    name: "MiniMax",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/minimax-color.svg",
  },
  {
    name: "Mistral",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/mistral-color.svg",
  },
  {
    name: "Gemini",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini-color.svg",
  },
  {
    name: "NVIDIA",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg",
  },
  {
    name: "Qwen",
    logo: "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/qwen-color.svg",
  },
] as const

// gpt-oss-120b (MODEL_OPTIONS[0]) is currently unresponsive on NIM — every
// request hangs with no error. Point the app default / planner at a model that
// is actually up so search and chat don't stall before they start.
export const DEFAULT_MODEL_ID: ModelId = "nvidia/nemotron-3-super-120b-a12b"
export const MODEL_IDS = MODEL_OPTIONS.map((model) => model.id) as [
  (typeof MODEL_OPTIONS)[number]["id"],
  ...(typeof MODEL_OPTIONS)[number]["id"][],
]
export const ModelIdSchema = z.enum(MODEL_IDS)

export type ModelId = z.infer<typeof ModelIdSchema>
export type ModelProvider = (typeof MODEL_OPTIONS)[number]["provider"]

export function getModelOption(modelId: string | undefined) {
  return MODEL_OPTIONS.find((model) => model.id === modelId) ?? MODEL_OPTIONS[0]
}

export function getModelProvider(modelId: ModelId): ModelProvider {
  return getModelOption(modelId).provider
}

export function getModelsForLab(labName: string) {
  return MODEL_OPTIONS.filter((model) => model.lab === labName)
}
