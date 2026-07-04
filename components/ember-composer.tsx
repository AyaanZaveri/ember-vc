"use client"

import {
  AuiIf,
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ChatModelAdapter,
  type SourceMessagePart,
  type ThreadAssistantMessagePart,
  type ThreadMessage,
  type ToolCallMessagePart,
  useThread,
  useThreadRuntime,
  useLocalRuntime,
} from "@assistant-ui/react"
import { DefaultChatTransport, readUIMessageStream, type UIMessage } from "ai"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"
import { MeshGradient } from "@paper-design/shaders-react"
import {
  ArrowUp,
  AlertCircle,
  BookOpen,
  BrainIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Globe,
  ListChecks,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  Telescope,
  TriangleAlert,
  Wrench,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought"
import { CitationAwareMarkdown } from "@/components/ai-elements/citation-renderer"
import { MessageResponse } from "@/components/ai-elements/message"
import { FirecrawlHeat } from "@/components/fc-heat"
import { useTheme } from "@/components/theme-provider"
import { ThemeSelect } from "@/components/theme-select"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SourceSchema, type ParsedSource } from "@/lib/ai/citations"
import {
  DEFAULT_MODEL_ID,
  getModelOption,
  getModelsForLab,
  MODEL_LABS,
  MODEL_OPTIONS,
  ModelIdSchema,
  type ModelId,
} from "@/lib/ai/models"
import { getCurrentRequestContext } from "@/lib/ai/request-context"

type ApiChatMessage = {
  id: string
  role: "user" | "assistant"
  parts: Array<{ type: "text"; text: string }>
}

type UiMessagePart = UIMessage["parts"][number]

type SourceLink = {
  readError?: string
  readSeconds?: number
  readStatus?: "complete" | "error" | "reading"
  title?: string
  url: string
}

function getTextContent(message: ThreadMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

function toUiMessage(message: ThreadMessage): ApiChatMessage | null {
  if (message.role !== "user" && message.role !== "assistant") {
    return null
  }

  const content = getTextContent(message).trim()

  if (!content) {
    return null
  }

  return {
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: content }],
  }
}

const searchTransport = new DefaultChatTransport<UIMessage>({
  api: "/api/search",
})

type UiMessageStream = Parameters<typeof readUIMessageStream>[0]["stream"]

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

/**
 * Reads assistant content parts off a UI message stream, stopping cleanly the
 * moment the run is aborted. Without the abort guard, a torn-down stream (New
 * Chat mid-generation, a superseding message, a dropped connection, or an HMR
 * reload in dev) keeps yielding into a runtime whose message repository was
 * already reset — surfacing as "Parent message not found" and "Cannot close an
 * errored readable stream". Abort errors are swallowed; real errors propagate.
 */
async function* readAssistantContent(
  stream: UiMessageStream,
  abortSignal: AbortSignal
) {
  try {
    for await (const message of readUIMessageStream({
      stream,
      onError: () => {},
    })) {
      if (abortSignal.aborted) {
        return
      }

      yield { content: toAssistantContentParts(message) }
    }
  } catch (error) {
    if (abortSignal.aborted || isAbortError(error)) {
      return
    }

    throw error
  }
}

function getAssistantContentParts(message: ThreadMessage) {
  return message.content.filter(
    (
      part
    ): part is Extract<
      ThreadAssistantMessagePart,
      { type: "text" | "reasoning" | "tool-call" | "source" }
    > =>
      part.type === "text" ||
      part.type === "reasoning" ||
      part.type === "tool-call" ||
      part.type === "source"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isToolPart(part: UiMessagePart) {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

function getToolName(part: UiMessagePart) {
  if (part.type === "dynamic-tool" && "toolName" in part) {
    return part.toolName
  }

  if (part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length)
  }

  return "tool"
}

function stringifyInput(input: unknown) {
  if (input === undefined) {
    return ""
  }

  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function toToolCallPart(part: UiMessagePart): ToolCallMessagePart | null {
  if (!isToolPart(part)) {
    return null
  }

  const toolPart = part as UiMessagePart & {
    errorText?: string
    input?: unknown
    output?: unknown
    state?: string
    toolCallId?: string
  }

  const input = isRecord(toolPart.input) ? toolPart.input : {}
  const hasOutput = toolPart.state === "output-available"
  const hasError = toolPart.state === "output-error"

  return {
    type: "tool-call",
    toolCallId:
      toolPart.toolCallId ?? `${getToolName(part)}-${crypto.randomUUID()}`,
    toolName: getToolName(part),
    args: input as ToolCallMessagePart["args"],
    argsText: stringifyInput(toolPart.input),
    result: hasOutput
      ? toolPart.output
      : hasError
        ? toolPart.errorText
        : undefined,
    isError: hasError,
  }
}

function toAssistantContentParts(message: UIMessage) {
  return message.parts.flatMap((part): ThreadAssistantMessagePart[] => {
    if (part.type === "text" || part.type === "reasoning") {
      return [{ type: part.type, text: part.text }]
    }

    if (part.type === "source-url") {
      return [
        {
          type: "source",
          sourceType: "url",
          id: part.sourceId,
          url: part.url,
          title: part.title,
        },
      ]
    }

    if (part.type === "source-document") {
      return [
        {
          type: "source",
          sourceType: "document",
          id: part.sourceId,
          title: part.title,
          mediaType: part.mediaType,
          filename: part.filename,
        },
      ]
    }

    const toolPart = toToolCallPart(part)

    return toolPart ? [toolPart] : []
  })
}

const SEARCH_MODES = [
  { id: "deep-research", label: "Deep Research", Icon: Telescope },
] as const

type SearchModeId = (typeof SEARCH_MODES)[number]["id"]

const MODEL_STORAGE_KEY = "ember:selected-model"

function getStoredModelId() {
  if (typeof window === "undefined") {
    return DEFAULT_MODEL_ID
  }

  const parsed = ModelIdSchema.safeParse(
    window.localStorage.getItem(MODEL_STORAGE_KEY)
  )

  return parsed.success ? parsed.data : DEFAULT_MODEL_ID
}

function getLastUserQuery(messages: readonly ThreadMessage[]) {
  const lastUserMessage = messages.findLast(
    (message) => message.role === "user"
  )

  return lastUserMessage ? getTextContent(lastUserMessage).trim() : ""
}

function getProviderLogoClass(providerName: string, className: string) {
  return `${className} ${providerName === "OpenAI" ? "dark:brightness-0 dark:invert" : ""
    }`
}

function collectThreadSearchSources(messages: readonly ThreadMessage[]) {
  const toolAndSourceParts = messages.flatMap((message) =>
    message.content.filter(
      (part): part is ToolCallMessagePart | SourceMessagePart =>
        part.type === "tool-call" || part.type === "source"
    )
  )

  return collectMessageSources(toolAndSourceParts)
}

function createChatAdapter({
  modelId,
}: {
  modelId: ModelId
}): ChatModelAdapter {
  return {
    async *run({ abortSignal, messages }) {
      const uiMessages = messages
        .map(toUiMessage)
        .filter((message): message is ApiChatMessage => message !== null)

      const query = getLastUserQuery(messages)
      const previousSources = collectThreadSearchSources(messages)

      const stream = await searchTransport.sendMessages({
        abortSignal,
        chatId: "ember",
        messageId: undefined,
        messages: uiMessages,
        body: {
          currentDateContext: getCurrentRequestContext(),
          query,
          modelId,
          mode: "completenessAudit",
          sources: previousSources,
        },
        trigger: "submit-message",
      })

      yield* readAssistantContent(stream, abortSignal)
    },
  }
}

function EmberLogo({ className = "" }: { className?: string }) {
  return (
    <motion.div
      layout
      layoutId="ember-logo"
      className={`relative flex scale-90 items-center gap-2 sm:scale-100 ${className} -ml-2.75`}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <div className="absolute -inset-x-5 inset-y-1 rounded-full bg-primary/10 blur-3xl dark:bg-primary/20" />
      <motion.div layout className="relative -top-1 size-14 shrink-0">
        <FirecrawlHeat />
      </motion.div>
      <motion.h1
        layout
        className="relative font-heading text-4xl font-semibold tracking-tight text-foreground select-none"
      >
        Ember
      </motion.h1>
    </motion.div>
  )
}

function ComposerForm({
  currentSearchMode,
  currentModel,
  modelId,
  searchMode,
  setModelId,
  setSearchMode,
}: {
  currentSearchMode: (typeof SEARCH_MODES)[number]
  currentModel: (typeof MODEL_OPTIONS)[number]
  modelId: ModelId
  searchMode: SearchModeId
  setModelId: (value: ModelId) => void
  setSearchMode: (value: SearchModeId) => void
}) {
  const CurrentSearchIcon = currentSearchMode.Icon

  return (
    <motion.div
      layout
      layoutId="ember-composer"
      className="mx-auto w-full max-w-3xl"
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <ComposerPrimitive.Root className="w-full">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[0_24px_80px_rgba(0,0,0,0.18)] shadow-primary/5 backdrop-blur-sm transition-colors duration-300 ease-in focus-within:border-border dark:shadow-primary/10">
          <ComposerPrimitive.Input
            asChild
            submitMode="enter"
            unstable_focusOnRunStart={false}
            unstable_focusOnScrollToBottom={false}
          >
            <Textarea
              rows={2}
              placeholder="Ask anything..."
              className="min-h-20 resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-base! leading-7 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            />
          </ComposerPrimitive.Input>
          <div className="flex items-center justify-between px-4 pb-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="rounded-full"
                aria-label="Add source"
              >
                <Plus data-icon />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full px-2.5!"
                  >
                    <CurrentSearchIcon
                      data-icon="inline-start"
                      className="sm:mr-0.5"
                    />
                    <span className="hidden sm:inline">
                      {currentSearchMode.label}
                    </span>
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent sideOffset={10} className="min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuRadioGroup
                      value={searchMode}
                      onValueChange={(value) =>
                        setSearchMode(value as SearchModeId)
                      }
                    >
                      {SEARCH_MODES.map(({ id, label, Icon }) => (
                        <DropdownMenuRadioItem key={id} value={id}>
                          <Icon />
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="hidden rounded-full px-2.5! sm:inline-flex"
                  >
                    <span
                      aria-hidden
                      className={getProviderLogoClass(
                        currentModel.lab,
                        "size-4 rounded-sm sm:mr-0.5"
                      )}
                      style={{
                        backgroundImage: `url(${currentModel.logo})`,
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "contain",
                      }}
                    />
                    <span className="hidden sm:inline">
                      {currentModel.shortLabel}
                    </span>
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={10}
                  className="min-w-48"
                >
                  <DropdownMenuGroup>
                    {MODEL_LABS.map((lab) => (
                      <DropdownMenuSub key={lab.name}>
                        <DropdownMenuSubTrigger>
                          <span
                            aria-hidden
                            className={getProviderLogoClass(
                              lab.name,
                              "size-4 rounded-sm"
                            )}
                            style={{
                              backgroundImage: `url(${lab.logo})`,
                              backgroundPosition: "center",
                              backgroundRepeat: "no-repeat",
                              backgroundSize: "contain",
                            }}
                          />
                          {lab.name}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="min-w-72">
                          <DropdownMenuRadioGroup
                            value={modelId}
                            onValueChange={(value) =>
                              setModelId(value as ModelId)
                            }
                          >
                            {getModelsForLab(lab.name).map((model) => (
                              <DropdownMenuRadioItem
                                key={model.id}
                                value={model.id}
                              >
                                <span
                                  aria-hidden
                                  className={getProviderLogoClass(
                                    model.lab,
                                    "size-4 rounded-sm"
                                  )}
                                  style={{
                                    backgroundImage: `url(${model.logo})`,
                                    backgroundPosition: "center",
                                    backgroundRepeat: "no-repeat",
                                    backgroundSize: "contain",
                                  }}
                                />
                                <span className="flex min-w-0 flex-col">
                                  <span className="truncate">
                                    {model.label}
                                  </span>
                                  <span className="truncate text-xs text-muted-foreground">
                                    {model.id}
                                  </span>
                                </span>
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <Drawer>
                <DrawerTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full px-2.5! sm:hidden"
                  >
                    <span
                      aria-hidden
                      className={getProviderLogoClass(
                        currentModel.lab,
                        "size-4 rounded-sm sm:mr-0.5"
                      )}
                      style={{
                        backgroundImage: `url(${currentModel.logo})`,
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "contain",
                      }}
                    />
                    <span className="hidden sm:inline">
                      {currentModel.shortLabel}
                    </span>
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="pb-6">
                  <DrawerHeader className="pb-3 text-left">
                    <DrawerTitle>Select Model</DrawerTitle>
                    <DrawerDescription>
                      Choose the AI model you want to chat with.
                    </DrawerDescription>
                  </DrawerHeader>
                  <ScrollArea
                    className="max-h-[50vh]"
                    viewportClassName="px-4 py-2"
                  >
                    <div className="space-y-4 pr-3.5">
                      {MODEL_LABS.map((lab) => (
                        <div key={lab.name} className="space-y-1.5">
                          <div className="flex items-center gap-1.5 py-1 pl-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            <span
                              aria-hidden
                              className={getProviderLogoClass(
                                lab.name,
                                "size-3.5 rounded-xs"
                              )}
                              style={{
                                backgroundImage: `url(${lab.logo})`,
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                                backgroundSize: "contain",
                              }}
                            />
                            {lab.name}
                          </div>
                          <div className="flex flex-col gap-1">
                            {getModelsForLab(lab.name).map((model) => {
                              const isSelected = modelId === model.id
                              return (
                                <DrawerClose asChild key={model.id}>
                                  <button
                                    onClick={() => setModelId(model.id)}
                                    className={cn(
                                      "flex w-full items-center justify-between rounded-lg p-2.5 text-left text-sm transition-colors outline-none hover:bg-accent focus:bg-accent",
                                      isSelected
                                        ? "bg-accent font-medium text-accent-foreground"
                                        : "text-foreground/85"
                                    )}
                                  >
                                    <div className="flex min-w-0 items-center gap-2.5">
                                      <span
                                        aria-hidden
                                        className={getProviderLogoClass(
                                          model.lab,
                                          "size-4 shrink-0 rounded-sm"
                                        )}
                                        style={{
                                          backgroundImage: `url(${model.logo})`,
                                          backgroundPosition: "center",
                                          backgroundRepeat: "no-repeat",
                                          backgroundSize: "contain",
                                        }}
                                      />
                                      <div className="flex min-w-0 flex-col">
                                        <span className="truncate leading-normal">
                                          {model.label}
                                        </span>
                                        <span className="truncate text-xs leading-normal text-muted-foreground">
                                          {model.id}
                                        </span>
                                      </div>
                                    </div>
                                    {isSelected && (
                                      <Check className="size-4 shrink-0 text-primary" />
                                    )}
                                  </button>
                                </DrawerClose>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </DrawerContent>
              </Drawer>
              <AuiIf condition={(s) => !s.composer.isEmpty}>
                <ComposerPrimitive.Send asChild>
                  <Button
                    size="icon-sm"
                    className="rounded-full"
                    aria-label="Send"
                  >
                    <ArrowUp data-icon />
                  </Button>
                </ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(s) => s.composer.isEmpty}>
                <Button
                  type="button"
                  size="icon-sm"
                  className="rounded-full"
                  disabled
                  aria-label="Send"
                >
                  <ArrowUp data-icon />
                </Button>
              </AuiIf>
            </div>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </motion.div>
  )
}

function ComposerShell() {
  const [searchMode, setSearchMode] = useState<SearchModeId>("deep-research")
  const [modelId, setModelId] = useState<ModelId>(DEFAULT_MODEL_ID)
  const [isModelPreferenceReady, setIsModelPreferenceReady] = useState(false)
  const chatAdapter = useMemo(
    () => createChatAdapter({ modelId }),
    [modelId]
  )
  const runtime = useLocalRuntime(chatAdapter)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModelId(getStoredModelId())
    setIsModelPreferenceReady(true)
  }, [])

  useEffect(() => {
    if (!isModelPreferenceReady) {
      return
    }

    window.localStorage.setItem(MODEL_STORAGE_KEY, modelId)
  }, [isModelPreferenceReady, modelId])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <LayoutGroup>
        <ComposerThread
          modelId={modelId}
          searchMode={searchMode}
          setModelId={setModelId}
          setSearchMode={setSearchMode}
        />
      </LayoutGroup>
    </AssistantRuntimeProvider>
  )
}

const messageReasoningDurations = new Map<string, number>()
const messageResponseDurations = new Map<string, number>()

const INITIAL_THOUGHT_LABELS = [
  "Warming up",
  "Thinking",
  "Taking a look",
  "Getting ready",
  "Looking into it",
  "Working on it",
  "Making sense of it",
  "Getting into it",
]

function getCurrentTime() {
  return Date.now()
}

function getStableIndex(value: string, modulo: number) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash % modulo
}

function getInitialThoughtLabel(messageId: string) {
  return INITIAL_THOUGHT_LABELS[
    getStableIndex(messageId, INITIAL_THOUGHT_LABELS.length)
  ]
}

function getReasoningText(
  parts: Extract<
    ThreadAssistantMessagePart,
    { type: "reasoning" | "tool-call" | "source" }
  >[]
) {
  return parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
}

function AssistantMessageActions({ duration }: { duration: number | null }) {
  return (
    <TooltipProvider>
      <ActionBarPrimitive.Root className="mt-1 -ml-2 flex items-center">
        <Tooltip>
          <ActionBarPrimitive.Copy asChild copiedDuration={1600}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="scale-95 rounded-full text-muted-foreground hover:text-foreground active:scale-90!"
                aria-label="Copy response"
              >
                <Copy
                  data-icon
                  className="group-data-[copied=true]/button:hidden"
                />
                <Check
                  data-icon
                  className="hidden group-data-[copied=true]/button:block"
                />
              </Button>
            </TooltipTrigger>
          </ActionBarPrimitive.Copy>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>
        <Tooltip>
          <ActionBarPrimitive.Reload asChild>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="scale-95 rounded-full text-muted-foreground hover:text-foreground active:scale-90!"
                aria-label="Rewrite response"
              >
                <RotateCcw data-icon />
              </Button>
            </TooltipTrigger>
          </ActionBarPrimitive.Reload>
          <TooltipContent>Rewrite</TooltipContent>
        </Tooltip>
        {duration !== null && (
          <span className="ml-2 font-mono text-sm text-muted-foreground/60 select-none">
            {duration.toFixed(1)}s
          </span>
        )}
      </ActionBarPrimitive.Root>
    </TooltipProvider>
  )
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function getFaviconUrl(url: string) {
  const hostname = getHostname(url)

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`
}

function getToolIcon(toolName: string) {
  if (toolName === "search" || toolName === "probe" || toolName === "expand") {
    return Search
  }

  if (toolName === "classify") {
    return ListChecks
  }

  if (toolName === "entities") {
    return Telescope
  }

  if (toolName === "context") {
    return FileText
  }

  if (toolName === "scrape" || toolName === "batchScrape") {
    return FileText
  }

  if (toolName === "map" || toolName === "crawl") {
    return Globe
  }

  return Wrench
}

function getSearchReadState(part: ToolCallMessagePart) {
  if (part.toolName !== "search" || !isRecord(part.result)) {
    return undefined
  }

  return part.result.status === "scraping" || part.result.status === "complete"
    ? part.result.status
    : undefined
}

function formatToolName(toolName: string) {
  if (toolName === "query") {
    return "Refining Search"
  }

  if (toolName === "expand") {
    return "Expanding Into Search Angles"
  }

  if (toolName === "entities") {
    return "Finding Entities To Probe"
  }

  if (toolName === "probe") {
    return "Searching"
  }

  if (toolName === "classify") {
    return "Classifying Sources By Type"
  }

  if (toolName === "search") {
    return "Reading Sources"
  }

  return toolName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getToolInputSummary(part: ToolCallMessagePart) {
  if (part.toolName === "query") {
    return undefined
  }

  const args = isRecord(part.args) ? part.args : {}
  const result = isRecord(part.result) ? part.result : {}

  if (part.toolName === "classify") {
    const done = typeof result.done === "number" ? result.done : undefined
    const total = typeof result.total === "number" ? result.total : undefined
    if (total !== undefined) {
      return `${done ?? 0} of ${total} sources`
    }
    return undefined
  }

  if (part.toolName === "entities") {
    const entities = Array.isArray(args.entities) ? args.entities : []
    return entities.filter((e) => typeof e === "string").join(", ") || undefined
  }

  const query = args.query
  const url = args.url

  if (typeof query === "string") {
    return query
  }

  if (typeof url === "string") {
    return url
  }

  return undefined
}

function collectSourceLinks(value: unknown, links: SourceLink[] = []) {
  if (links.length >= 50) {
    return links
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSourceLinks(item, links)
    }

    return links
  }

  if (!isRecord(value)) {
    return links
  }

  const url =
    typeof value.url === "string"
      ? value.url
      : typeof value.sourceURL === "string"
        ? value.sourceURL
        : typeof value.sourceUrl === "string"
          ? value.sourceUrl
          : undefined

  if (url) {
    const readStatus =
      value.readStatus === "complete" ||
        value.readStatus === "error" ||
        value.readStatus === "reading"
        ? value.readStatus
        : undefined
    const readSeconds =
      typeof value.readSeconds === "number" ? value.readSeconds : undefined
    const readError =
      typeof value.readError === "string" ? value.readError : undefined

    links.push({
      readError,
      readSeconds,
      readStatus,
      title: typeof value.title === "string" ? value.title : undefined,
      url,
    })
  }

  for (const nestedValue of Object.values(value)) {
    collectSourceLinks(nestedValue, links)
  }

  return links
}

function dedupeSourceLinks(links: SourceLink[]) {
  const seen = new Set<string>()

  return links.filter((link) => {
    if (seen.has(link.url)) {
      return false
    }

    seen.add(link.url)
    return true
  })
}

function getPartSourceLinks(part: ToolCallMessagePart | SourceMessagePart) {
  if (part.type === "source") {
    return part.sourceType === "url"
      ? [{ title: part.title, url: part.url }]
      : []
  }

  return dedupeSourceLinks(collectSourceLinks(part.result))
}

interface RawSourceItem {
  url?: unknown
  title?: unknown
  description?: unknown
  snippet?: unknown
  markdown?: unknown
  readError?: unknown
  readSeconds?: unknown
  readStatus?: unknown
  summary?: unknown
  favicon?: unknown
  metadata?: {
    url?: unknown
    title?: unknown
    description?: unknown
    sourceURL?: unknown
    favicon?: unknown
  }
}

/**
 * Attempts to extract fully-structured `ParsedSource` objects from a
 * Firecrawl tool-call result. The Firecrawl search tool returns an object
 * shaped like `{ query, sources: SearchResultSource[] }`. We validate each
 * source entry against `SourceSchema` so unrecognised shapes are silently
 * dropped rather than crashing the UI.
 */
function collectMessageSources(
  parts: (ToolCallMessagePart | SourceMessagePart)[]
): ParsedSource[] {
  const seen = new Set<string>()
  const result: ParsedSource[] = []

  for (const part of parts) {
    if (part.type !== "tool-call") continue
    if (!isRecord(part.result)) continue

    const query = typeof part.args?.query === "string" ? part.args.query : ""

    const rawItems: unknown[] = []
    if (Array.isArray(part.result.sources)) {
      rawItems.push(...part.result.sources)
    } else if (Array.isArray(part.result.web)) {
      rawItems.push(...part.result.web)
    } else if (part.toolName === "scrape" && part.result) {
      rawItems.push(part.result)
    }

    for (const rawItem of rawItems) {
      if (!isRecord(rawItem)) continue
      const raw = rawItem as RawSourceItem

      const url =
        (typeof raw.url === "string" ? raw.url : null) ||
        (typeof raw.metadata?.url === "string" ? raw.metadata.url : null) ||
        (typeof raw.metadata?.sourceURL === "string"
          ? raw.metadata.sourceURL
          : null) ||
        ""

      if (!url) continue

      const title =
        (typeof raw.title === "string" ? raw.title : null) ||
        (typeof raw.metadata?.title === "string" ? raw.metadata.title : null) ||
        ""

      const description =
        (typeof raw.description === "string" ? raw.description : null) ||
        (typeof raw.metadata?.description === "string"
          ? raw.metadata.description
          : null) ||
        ""

      const snippet =
        (typeof raw.snippet === "string" ? raw.snippet : null) ||
        (typeof raw.markdown === "string" ? raw.markdown : null) ||
        (typeof raw.summary === "string" ? raw.summary : null) ||
        ""

      const favicon =
        (typeof raw.favicon === "string" ? raw.favicon : null) ||
        (typeof raw.metadata?.favicon === "string"
          ? raw.metadata.favicon
          : null) ||
        undefined

      const mappedSource = {
        title,
        url,
        description,
        snippet,
        query,
        readError: typeof raw.readError === "string" ? raw.readError : undefined,
        readSeconds:
          typeof raw.readSeconds === "number" ? raw.readSeconds : undefined,
        readStatus:
          raw.readStatus === "complete" ||
            raw.readStatus === "error" ||
            raw.readStatus === "reading"
            ? raw.readStatus
            : undefined,
        favicon,
      }

      const parsed = SourceSchema.safeParse(mappedSource)
      if (!parsed.success) continue
      const source = parsed.data
      if (seen.has(source.url)) continue
      seen.add(source.url)
      result.push(source)
    }
  }

  return result
}

function getToolStatus(part: ToolCallMessagePart, isStreaming: boolean) {
  if (part.isError) {
    return "complete"
  }

  if (getSearchReadState(part) === "scraping") {
    return "active"
  }

  if (part.result !== undefined) {
    return "complete"
  }

  return isStreaming ? "active" : "pending"
}

function getToolStatusIcon(part: ToolCallMessagePart, isStreaming: boolean) {
  if (part.isError) {
    return AlertCircle
  }

  if (getSearchReadState(part) === "scraping") {
    return BookOpen
  }

  if (part.result !== undefined) {
    return CheckCircle2
  }

  return isStreaming ? LoaderCircle : getToolIcon(part.toolName)
}

function AssistantActivity({
  duration,
  hasResponseStarted,
  initialThoughtLabel,
  isStreaming,
  parts,
}: {
  duration: number | null
  hasResponseStarted: boolean
  initialThoughtLabel: string
  isStreaming: boolean
  parts: Extract<
    ThreadAssistantMessagePart,
    { type: "reasoning" | "tool-call" | "source" }
  >[]
}) {
  const reasoningText = getReasoningText(parts)
  const toolAndSourceParts = parts.filter(
    (part): part is ToolCallMessagePart | SourceMessagePart =>
      part.type === "tool-call" || part.type === "source"
  )
  const sourceCount = dedupeSourceLinks(
    toolAndSourceParts.flatMap(getPartSourceLinks)
  ).length
  const isGeneratingSearchQuery = toolAndSourceParts.some(
    (part) =>
      part.type === "tool-call" &&
      part.toolName === "query" &&
      part.result === undefined &&
      !part.isError
  )
  const isReadingSources = toolAndSourceParts.some(
    (part) =>
      part.type === "tool-call" && getSearchReadState(part) === "scraping"
  )
  const isInitialThinking =
    isStreaming &&
    !hasResponseStarted &&
    !reasoningText &&
    toolAndSourceParts.length === 0
  const headerLabel = isStreaming
    ? isGeneratingSearchQuery
      ? "Finding better search words..."
      : isReadingSources
        ? "Reading sources..."
        : isInitialThinking
          ? `${initialThoughtLabel}...`
          : "Working with sources..."
    : sourceCount > 0
      ? `Looked at ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
      : duration !== null
        ? `Reasoned for ${duration.toFixed(1)} seconds`
        : "Reasoning"
  const hasActivityDetails =
    Boolean(reasoningText) || toolAndSourceParts.length > 0
  const [isManuallyOpen, setIsManuallyOpen] = useState(false)
  const shouldAutoOpen =
    isStreaming && !hasResponseStarted && hasActivityDetails
  const isOpen = isStreaming ? shouldAutoOpen : isManuallyOpen

  return (
    <ChainOfThought
      className="mb-4"
      onOpenChange={setIsManuallyOpen}
      open={isOpen}
      key={hasResponseStarted ? "response-started" : "activity-streaming"}
    >
      <ChainOfThoughtHeader>
        {isStreaming ? (
          <span className="shimmer text-sm text-muted-foreground">
            {headerLabel}
          </span>
        ) : (
          headerLabel
        )}
      </ChainOfThoughtHeader>
      {hasActivityDetails ? (
        <ChainOfThoughtContent>
          {reasoningText ? (
            <ChainOfThoughtStep
              icon={BrainIcon}
              label="Reasoned through the request"
              status={isStreaming ? "active" : "complete"}
            >
              <ScrollArea
                className="max-h-48 rounded-md bg-muted/40 text-xs leading-5 text-muted-foreground"
                viewportClassName="p-3"
              >
                <MessageResponse>{reasoningText}</MessageResponse>
              </ScrollArea>
            </ChainOfThoughtStep>
          ) : null}

          {toolAndSourceParts.map((part, index) => {
            if (part.type === "source") {
              const links = getPartSourceLinks(part)

              return (
                <ChainOfThoughtStep
                  key={`${part.id}-${index}`}
                  icon={Globe}
                  label="Found source"
                  status="complete"
                >
                  <SourceChips links={links} />
                </ChainOfThoughtStep>
              )
            }

            const links = getPartSourceLinks(part)
            const inputSummary = getToolInputSummary(part)
            const isActive = getToolStatus(part, isStreaming) === "active"
            const Icon = getToolStatusIcon(part, isStreaming)
            const shouldSpinIcon = isActive && Icon === LoaderCircle

            return (
              <ChainOfThoughtStep
                key={part.toolCallId}
                className={
                  shouldSpinIcon ? "[&>div:first-child>svg]:animate-spin" : ""
                }
                description={inputSummary}
                icon={Icon}
                label={formatToolName(part.toolName)}
                status={getToolStatus(part, isStreaming)}
              >
                <SourceChips links={links} />
              </ChainOfThoughtStep>
            )
          })}
        </ChainOfThoughtContent>
      ) : null}
    </ChainOfThought>
  )
}

function SourceReadStatusIcon({ link }: { link: SourceLink }) {
  if (link.readStatus === "complete") {
    return (
      <CheckCircle2
        aria-hidden
        className="size-3 text-lime-600 dark:text-lime-500"
      />
    )
  }

  if (link.readStatus === "error") {
    return <AlertCircle aria-hidden className="size-3 text-destructive" />
  }

  if (link.readStatus === "reading") {
    return (
      <LoaderCircle
        aria-hidden
        className="size-3 animate-spin text-muted-foreground"
      />
    )
  }

  return null
}

function SourceChips({ links }: { links: SourceLink[] }) {
  const dedupedLinks = dedupeSourceLinks(links).slice(0, 6)

  if (dedupedLinks.length === 0) {
    return null
  }

  return (
    <ChainOfThoughtSearchResults>
      {dedupedLinks.map((link) => (
        <ChainOfThoughtSearchResult asChild key={link.url}>
          <a
            className="max-w-64 pr-1"
            href={link.url}
            rel="noreferrer"
            target="_blank"
            title={
              link.readError
                ? `${getHostname(link.url)}: ${link.readError}`
                : link.readSeconds !== undefined
                  ? `${getHostname(link.url)} read in ${link.readSeconds.toFixed(1)}s`
                  : getHostname(link.url)
            }
          >
            <span
              aria-hidden
              className="size-3 rounded-sm"
              style={{
                backgroundImage: `url(${getFaviconUrl(link.url)})`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "contain",
              }}
            />
            <span className="max-w-40 truncate">{getHostname(link.url)}</span>
            <SourceReadStatusIcon link={link} />
          </a>
        </ChainOfThoughtSearchResult>
      ))}
    </ChainOfThoughtSearchResults>
  )
}

function CitationAwareTextPart({
  text,
  sources,
}: {
  text: string
  sources: ParsedSource[]
}) {
  return <CitationAwareMarkdown sources={sources} text={text} />
}

type CoverageReportData = {
  query: string
  queriesRun: string[]
  totalSourcesFound: number
  droppedCount: number
  gaps: string[]
  thin: string[]
  byCategory: {
    category: string
    wanted: boolean
    count: number
    sources: {
      url: string
      title: string
      confidence: string
      extractable: boolean
    }[]
  }[]
}

function prettyCategory(id: string) {
  return id.replace(/_/g, " ")
}

/**
 * Pulls the CoverageReport out of the `report` tool part emitted by the
 * completeness-audit stream. Returns null for non-audit messages.
 */
function getReportFromParts(
  parts: ThreadAssistantMessagePart[]
): { report: CoverageReportData; profileLabel?: string; profileDescription?: string } | null {
  for (const part of parts) {
    if (part.type !== "tool-call" || part.toolName !== "report") continue
    if (!isRecord(part.result)) continue
    const result = part.result
    if (!isRecord(result.report)) continue
    return {
      report: result.report as unknown as CoverageReportData,
      profileLabel:
        typeof result.profileLabel === "string" ? result.profileLabel : undefined,
      profileDescription:
        typeof result.profileDescription === "string"
          ? result.profileDescription
          : undefined,
    }
  }
  return null
}

function GapReport({
  report,
  profileDescription,
}: {
  report: CoverageReportData
  profileDescription?: string
}) {
  const populated = report.byCategory.filter((category) => category.count > 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mt-2 space-y-5 leading-6 text-foreground"
    >
      <p className="text-[15px] text-foreground/90">
        {profileDescription
          ? `${profileDescription} `
          : ""}
        {`Across ${report.queriesRun.length} search angles and entity probes I pulled ${report.totalSourcesFound} unique sources and set aside ${report.droppedCount} that don't fit.`}
      </p>

      {report.gaps.length > 0 ? (
        <div>
          <div className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
            <TriangleAlert className="size-4 text-amber-500" />
            Gaps — source types you wanted that returned nothing
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {report.gaps.map((category) => (
              <span
                key={category}
                className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                {prettyCategory(category)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[15px] font-medium text-foreground">
          <CheckCircle2 className="size-4 text-lime-500" />
          Every source type you wanted has at least one result.
        </p>
      )}

      <div className="space-y-3.5">
        {populated.map((category) => (
          <div key={category.category}>
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className="font-medium text-foreground">
                {prettyCategory(category.category)}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs",
                  category.wanted
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {category.wanted ? "wanted" : "filtered"}
              </span>
              <span className="text-xs text-muted-foreground">{category.count}</span>
            </div>
            <div className="flex flex-col gap-0.5 pl-1">
              {category.sources.slice(0, 6).map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title={source.url}
                >
                  {source.title || source.url}
                  {!source.extractable ? " — flagged for manual review" : ""}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function AssistantMessageContent({ message }: { message: ThreadMessage }) {
  const parts = getAssistantContentParts(message)
  const isStreaming =
    message.role === "assistant" && message.status.type === "running"
  // The completeness-audit `report` part is rendered as its own card below the
  // accordion — keep it out of the activity steps so it isn't shown as a chip.
  const reportPayload = getReportFromParts(parts)
  const activityParts = parts.filter(
    (
      part
    ): part is Extract<
      ThreadAssistantMessagePart,
      { type: "reasoning" | "tool-call" | "source" }
    > =>
      part.type === "reasoning" ||
      (part.type === "tool-call" && part.toolName !== "report") ||
      part.type === "source"
  )
  const reasoningText = getReasoningText(activityParts)
  const textParts = parts.filter(
    (part): part is Extract<ThreadAssistantMessagePart, { type: "text" }> =>
      part.type === "text"
  )
  const hasResponseStarted = textParts.some((part) => part.text.trim())

  // Collect structured Firecrawl sources from all tool-call results so we
  // can map [1], [2] markers in the text to real source metadata.
  const toolAndSourceParts = parts.filter(
    (part): part is ToolCallMessagePart | SourceMessagePart =>
      part.type === "tool-call" || part.type === "source"
  )
  const messageSources = collectMessageSources(toolAndSourceParts)
  const shouldShowActivity =
    activityParts.length > 0 || (isStreaming && !hasResponseStarted)
  const initialThoughtLabel = useMemo(
    () => getInitialThoughtLabel(message.id),
    [message.id]
  )

  const [reasoningDuration, setReasoningDuration] = useState<number | null>(
    () => messageReasoningDurations.get(message.id) ?? null
  )
  const [responseDuration, setResponseDuration] = useState<number | null>(
    () => messageResponseDurations.get(message.id) ?? null
  )
  const responseStartTimeRef = useRef<number | null>(null)
  const reasoningStartTimeRef = useRef<number | null>(null)
  const lastReasoningDeltaTimeRef = useRef<number | null>(null)
  const previousReasoningTextRef = useRef("")

  useEffect(() => {
    if (messageResponseDurations.has(message.id)) {
      return
    }

    if (isStreaming) {
      if (responseStartTimeRef.current === null) {
        responseStartTimeRef.current = getCurrentTime()
        setResponseDuration(null)
      }

      return
    }

    if (responseStartTimeRef.current !== null) {
      const elapsed = (getCurrentTime() - responseStartTimeRef.current) / 1000
      const rounded = Math.round(elapsed * 10) / 10
      messageResponseDurations.set(message.id, rounded)
      setResponseDuration(rounded)
      responseStartTimeRef.current = null
    }
  }, [isStreaming, message.id])

  useEffect(() => {
    if (messageReasoningDurations.has(message.id)) {
      return
    }

    if (!isStreaming) {
      return
    }

    if (reasoningText && reasoningText !== previousReasoningTextRef.current) {
      const now = getCurrentTime()

      if (reasoningStartTimeRef.current === null) {
        reasoningStartTimeRef.current = now
        setReasoningDuration(null)
      }

      lastReasoningDeltaTimeRef.current = now
      previousReasoningTextRef.current = reasoningText
    }
  }, [isStreaming, message.id, reasoningText])

  useEffect(() => {
    if (isStreaming) {
      return
    }

    const reasoningStartTime = reasoningStartTimeRef.current
    const lastReasoningDeltaTime = lastReasoningDeltaTimeRef.current

    if (reasoningStartTime !== null && lastReasoningDeltaTime !== null) {
      const elapsed = (lastReasoningDeltaTime - reasoningStartTime) / 1000
      const rounded = Math.round(elapsed * 10) / 10
      messageReasoningDurations.set(message.id, rounded)
      setReasoningDuration(rounded)
      reasoningStartTimeRef.current = null
      lastReasoningDeltaTimeRef.current = null
    }
  }, [isStreaming, message.id])

  return (
    <>
      {shouldShowActivity ? (
        <AssistantActivity
          duration={reasoningDuration}
          hasResponseStarted={hasResponseStarted}
          initialThoughtLabel={initialThoughtLabel}
          isStreaming={isStreaming}
          parts={activityParts}
        />
      ) : null}
      {textParts.map((part, index) => (
        <CitationAwareTextPart
          key={`text-${index}`}
          sources={messageSources}
          text={part.text}
        />
      ))}
      {reportPayload ? (
        <GapReport
          report={reportPayload.report}
          profileDescription={reportPayload.profileDescription}
        />
      ) : null}
      {reportPayload ? null : (
        <AssistantMessageActions duration={responseDuration} />
      )}
    </>
  )
}

function ComposerThread({
  modelId,
  searchMode,
  setModelId,
  setSearchMode,
}: {
  modelId: ModelId
  searchMode: SearchModeId
  setModelId: (value: ModelId) => void
  setSearchMode: (value: SearchModeId) => void
}) {
  const hasMessages = useThread((thread) => thread.messages.length > 0)
  const threadRuntime = useThreadRuntime()
  const currentSearchMode =
    SEARCH_MODES.find((mode) => mode.id === searchMode) ?? SEARCH_MODES[0]
  const currentModel = getModelOption(modelId)
  const handleNewChat = () => {
    if (!threadRuntime.getState().isRunning) {
      threadRuntime.reset()
      return
    }

    // reset() wipes the message repository synchronously. Doing that mid-stream
    // orphans the in-flight assistant message (its parent user message vanishes),
    // which throws "Parent message not found" inside the runtime. Cancel first,
    // then reset only once the run has actually settled.
    threadRuntime.cancelRun()

    const unsubscribe = threadRuntime.subscribe(() => {
      if (!threadRuntime.getState().isRunning) {
        unsubscribe()
        threadRuntime.reset()
      }
    })
  }

  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === "dark"
  const gradientColors = isDark
    ? ["#ff4c00", "#c2410c", "#7c2d12", "#1c1917"]
    : ["#fff7ed", "#ffedd5", "#fed7aa", "#ff4c00"]

  return (
    <ThreadPrimitive.Root className="mx-auto flex min-h-svh w-full max-w-[58rem] flex-col">
      <AnimatePresence>
        {mounted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: hasMessages
                ? isDark
                  ? 0.22
                  : 0.36
                : isDark
                  ? 0.32
                  : 0.58,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className={`pointer-events-none fixed inset-x-0 z-0 overflow-hidden ${hasMessages ? "bottom-0 h-[28rem]" : "inset-y-0"
              }`}
            style={
              hasMessages
                ? {
                  WebkitMaskImage:
                    "linear-gradient(to top, black 0%, black 72%, transparent 100%)",
                  maskImage:
                    "linear-gradient(to top, black 0%, black 72%, transparent 100%)",
                }
                : undefined
            }
          >
            <MeshGradient
              colors={gradientColors}
              speed={0.5}
              distortion={0.38}
              swirl={0.15}
              style={{ width: "100%", height: "100%" }}
            />
            <div className="absolute inset-0 bg-background/35" />
            {/* Radial wash to blend/soften edges in both dark and light modes */}
            <div
              className="absolute inset-0"
              style={{
                background: hasMessages
                  ? `radial-gradient(ellipse at bottom, transparent 0%, var(--background) 82%)`
                  : `radial-gradient(circle, transparent 16%, var(--background) 92%)`,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ThreadPrimitive.Viewport
        autoScroll
        className={`relative z-10 flex flex-1 flex-col overflow-visible px-2 sm:px-20 ${hasMessages ? "pt-8 pb-56" : "justify-center py-8"
          }`}
      >
        {!hasMessages ? (
          <div className="flex w-full flex-col items-center gap-6 pb-[12svh] sm:gap-8">
            <EmberLogo className="justify-center" />
            <ComposerForm
              currentModel={currentModel}
              currentSearchMode={currentSearchMode}
              modelId={modelId}
              searchMode={searchMode}
              setModelId={setModelId}
              setSearchMode={setSearchMode}
            />
          </div>
        ) : (
          <>
            <motion.div
              layout
              className="sticky top-0 z-10 flex justify-center py-3"
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            >
              <button
                type="button"
                className="rounded-lg transition duration-300 ease-out outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] data-[state=open]:bg-secondary"
                aria-label="Start a new chat"
                onClick={handleNewChat}
              >
                <EmberLogo />
              </button>
            </motion.div>

            <ThreadPrimitive.Messages>
              {({ message }) => (
                <MessagePrimitive.Root>
                  <motion.div
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className={
                      message.role === "user"
                        ? "mt-4 ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 leading-6 text-secondary-foreground"
                        : "mt-4 mr-auto leading-6 text-foreground"
                    }
                  >
                    {message.role === "assistant" ? (
                      <AssistantMessageContent message={message} />
                    ) : (
                      <MessagePrimitive.Parts />
                    )}
                  </motion.div>
                </MessagePrimitive.Root>
              )}
            </ThreadPrimitive.Messages>

            <div className="min-h-8 flex-1" />
          </>
        )}
      </ThreadPrimitive.Viewport>

      {hasMessages ? (
        <ThreadPrimitive.ViewportFooter className="fixed inset-x-0 bottom-0 z-20 px-8 pb-8 sm:px-20">
          <div className="mx-auto w-full max-w-3xl">
            <ComposerForm
              currentModel={currentModel}
              currentSearchMode={currentSearchMode}
              modelId={modelId}
              searchMode={searchMode}
              setModelId={setModelId}
              setSearchMode={setSearchMode}
            />
          </div>
        </ThreadPrimitive.ViewportFooter>
      ) : null}
    </ThreadPrimitive.Root>
  )
}

export function EmberComposer() {
  return (
    <main className="relative isolate flex min-h-svh items-center justify-center overflow-x-hidden bg-background px-6 sm:px-10">
      <div className="absolute top-4 right-4 z-30">
        <ThemeSelect />
      </div>
      <ComposerShell />
    </main>
  )
}
