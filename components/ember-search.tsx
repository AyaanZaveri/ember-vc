"use client"

import { MeshGradient } from "@paper-design/shaders-react"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"
import {
  ArrowUp,
  Asterisk,
  CheckCircle2,
  CircleSlash,
  FileText,
  Gauge,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  TriangleAlert,
} from "lucide-react"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import { FirecrawlHeat } from "@/components/fc-heat"
import { useTheme } from "@/components/theme-provider"
import { ThemeSelect } from "@/components/theme-select"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  EFFORT_PRESET_META,
  isEffortPreset,
  type EffortPreset,
} from "@/lib/completeness/effort.ts"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// --- Types mirror the streamed events from /api/audit-stream + report.ts ---
type ClassifiedSourceEvent = {
  url: string
  title: string
  foundVia: string[]
  category: string
  matches: boolean
  confidence: "high" | "low"
  justification: string
  extractable: boolean
  parseFailed: boolean
  round: number
}
type CategoryBreakdown = {
  category: string
  wanted: boolean
  count: number
  sources: {
    url: string
    title: string
    confidence: string
    extractable: boolean
    justification: string
  }[]
}
type CoverageReport = {
  query: string
  queriesRun: string[]
  profileInclude: string[]
  totalSourcesFound: number
  droppedCount: number
  byCategory: CategoryBreakdown[]
  gaps: string[]
  thin: string[]
  stopReason?: "saturated" | "ceiling"
  roundsRun?: number
  searchCount?: number
  scrapeCount?: number
  elapsedMs?: number
}
type ProfileSummary = { id: string; include: string[]; categoryCount: number }
type TaxonomyCategory = { id: string; description: string }
type Phase = "idle" | "running" | "done" | "error"

const prettyCategory = (id: string) => id.replace(/_/g, " ")

/** "1m 23s" / "45s" — minutes only when applicable. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
const titleCaseCategory = (id: string) =>
  id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

/** Bare registrable-ish host for display + favicon (drops www.). */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function faviconUrl(url: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOf(url))}&sz=${size}`
}

// The chosen wanted-set persists across visits — a rubric is something a user
// sets once and reuses, not something they re-pick every audit.
const SOURCES_STORAGE_KEY = "ember:wanted-sources"
const EFFORT_STORAGE_KEY = "ember:effort"

function EmberLogo() {
  return (
    <motion.div
      layout
      layoutId="ember-logo"
      className="relative -ml-2.75 flex scale-90 items-center gap-2 sm:scale-100"
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

/** Animated mesh-gradient backdrop — lifted verbatim from the original homepage.
 * Full-screen when idle; recedes to a soft band at the top once a run starts. */
function MeshBackdrop({ active }: { active: boolean }) {
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
    <AnimatePresence>
      {mounted && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: active ? (isDark ? 0.18 : 0.28) : isDark ? 0.32 : 0.58 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className={cn(
            "pointer-events-none fixed inset-x-0 z-0 overflow-hidden",
            active ? "top-0 h-[24rem]" : "inset-y-0"
          )}
          style={
            active
              ? {
                WebkitMaskImage:
                  "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
                maskImage:
                  "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
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
          <div
            className="absolute inset-0"
            style={{
              background: active
                ? `radial-gradient(ellipse at top, transparent 0%, var(--background) 78%)`
                : `radial-gradient(circle, transparent 16%, var(--background) 92%)`,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The source-type picker. The taxonomy (what the classifier can label) is fixed;
 * this dialog edits which of those types COUNT as found — the per-report rubric,
 * i.e. the "tell search what I care about" control (#5). */
function SourcesDialog({
  taxonomy,
  include,
  onToggle,
  triggerClassName,
}: {
  taxonomy: TaxonomyCategory[]
  include: Set<string>
  onToggle: (id: string) => void
  triggerClassName?: string
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("rounded-full px-2.5! shadow-xl shadow-primary/2", triggerClassName)}
        >
          <SlidersHorizontal data-icon="inline-start" className="sm:mr-0.5" />
          <span className="hidden sm:inline">Sources</span>
          <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            {include.size}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg px-4" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Which sources count?</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[55vh] overflow-x-hidden">
          <div className="flex flex-col pr-3">
            {taxonomy.map((c) => {
              const on = include.has(c.id)
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggle(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onToggle(c.id)
                    }
                  }}
                  className="flex cursor-pointer items-start justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {titleCaseCategory(c.id)}
                    </span>
                    <span className="block text-xs text-muted-foreground">{c.description}</span>
                  </span>
                  <Switch checked={on} tabIndex={-1} className="pointer-events-none shrink-0 self-center" />
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

/** Depth/breadth selector — how hard the run digs. Standard is the default;
 * "Exhaustive" is the overnight-batch setting ("make it 10x slower, I don't care"). */
function DepthDropdown({
  effort,
  onChange,
}: {
  effort: EffortPreset
  onChange: (e: EffortPreset) => void
}) {
  const active = EFFORT_PRESET_META.find((p) => p.id === effort) ?? EFFORT_PRESET_META[1]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full px-2.5! shadow-xl shadow-primary/2"
        >
          <Gauge data-icon="inline-start" className="sm:mr-0.5" />
          <span className="hidden sm:inline">{active.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={effort}
          onValueChange={(v) => onChange(v as EffortPreset)}
        >
          {EFFORT_PRESET_META.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id} className="items-start">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.description}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The search box — same visual language as the old composer, but single-shot. */
function SearchBox({
  taxonomy,
  include,
  onToggleInclude,
  effort,
  onEffortChange,
  onSubmit,
  disabled,
}: {
  taxonomy: TaxonomyCategory[]
  include: Set<string>
  onToggleInclude: (id: string) => void
  effort: EffortPreset
  onEffortChange: (e: EffortPreset) => void
  onSubmit: (query: string) => void
  disabled: boolean
}) {
  const [value, setValue] = useState("")
  const submit = () => {
    const q = value.trim()
    if (!q || disabled) return
    onSubmit(q)
  }
  return (
    <motion.div
      layout
      layoutId="ember-search-box"
      className="mx-auto w-full max-w-3xl"
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[0_24px_80px_rgba(0,0,0,0.18)] shadow-primary/5 backdrop-blur-sm transition-colors duration-300 focus-within:border-border dark:shadow-primary/10">
        <Textarea
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Deep-research a topic's full source landscape…"
          className="min-h-20 resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-base! leading-7 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between px-4 pb-4">
          <div className="flex items-center gap-2">
            <SourcesDialog taxonomy={taxonomy} include={include} onToggle={onToggleInclude} />
            <DepthDropdown effort={effort} onChange={onEffortChange} />
          </div>
          <Button
            type="button"
            size="icon-sm"
            className="rounded-full"
            aria-label="Run audit"
            disabled={disabled}
            onClick={submit}
          >
            {disabled ? <LoaderCircle data-icon className="animate-spin" /> : <ArrowUp data-icon />}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

/** A source pill in the live classify feed. Colored by the server's `matches`
 * verdict — i.e. whether it counts under the CHOSEN source-type rubric, so the
 * highlighting tracks the picker automatically. */
function SourcePill({ source }: { source: ClassifiedSourceEvent }) {
  const host = domainOf(source.url)
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <ChainOfThoughtSearchResult asChild className={cn(source.matches && "ring-2 ring-primary/40")}>
          <button type="button" className="max-w-64 cursor-default">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm"
              style={{
                backgroundImage: `url(${faviconUrl(source.url)})`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "contain",
              }}
            />
            <span className="max-w-40 truncate">{host}</span>
            {!source.extractable && (
              <span data-icon="inline-end" className="inline-flex shrink-0 items-center self-center">
                <Asterisk className="size-3.5 text-primary" />
              </span>
            )}
          </button>
        </ChainOfThoughtSearchResult>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-80 space-y-2 shadow-xl shadow-primary/5">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden
            className="size-6 shrink-0 rounded-xs object-contain"
            onError={(e) => {
              ; (e.currentTarget as HTMLImageElement).style.display = "none"
            }}
            src={faviconUrl(source.url, 128)}
          />
          <div className="min-w-0 flex-1 space-y-0">
            <a
              href={source.url}
              rel="noreferrer"
              target="_blank"
              className="block truncate text-sm leading-tight font-medium hover:underline"
            >
              {source.title || host}
            </a>
            <p className="truncate font-mono text-xs text-muted-foreground">{host}</p>
          </div>
        </div>
        {source.justification && (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {source.justification}
          </p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <Badge variant={source.matches ? "default" : "secondary"} className="font-normal">
            {titleCaseCategory(source.category)}
          </Badge>
          {!source.extractable && (
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              <Asterisk className="size-3.5 text-primary" />
              flagged for review
            </span>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/** One round's classification step — interleaved after that round's probes,
 * because classification actually happens per round, not once at the end. */
function ClassifyStep({
  sources,
  active,
}: {
  sources: ClassifiedSourceEvent[]
  active: boolean
}) {
  if (sources.length === 0 && !active) return null
  const wanted = sources.filter((s) => s.matches).length
  return (
    <ChainOfThoughtStep
      icon={active ? LoaderCircle : CheckCircle2}
      // Scope the spin to the STEP'S OWN icon (first child) only — a broad
      // "[&_svg]:animate-spin" cascades into every descendant svg, including
      // the asterisk icons on the source pills rendered as this step's children.
      className={active ? "[&>div:first-child>svg]:animate-spin" : undefined}
      label={
        active
          ? `Classifying sources… ${sources.length}`
          : `Classified ${sources.length} source${sources.length === 1 ? "" : "s"} · ${wanted} wanted`
      }
      status={active ? "active" : "complete"}
    >
      <ChainOfThoughtSearchResults className="mt-1 p-1">
        {sources.map((s) => (
          <SourcePill key={s.url} source={s} />
        ))}
      </ChainOfThoughtSearchResults>
    </ChainOfThoughtStep>
  )
}

/** The live "thinking" accordion — one step per pipeline stage, filled from the stream. */
function ThinkingAccordion({
  phase,
  variants,
  probes,
  entityRounds,
  reading,
  dryRounds,
  classified,
}: {
  phase: Phase
  variants: string[]
  probes: { query: string; round: number; count: number }[]
  entityRounds: { round: number; entities: string[] }[]
  reading: { round: number; count: number }[]
  dryRounds: { round: number; reason: "no-new-entities" | "no-new-wanted" }[]
  classified: ClassifiedSourceEvent[]
}) {
  const done = phase === "done" || phase === "error"
  const r1 = probes.filter((p) => p.round === 1)

  // Depth rounds (2+): every round that read pages, pulled entities, probed, or
  // came back dry (found nothing new).
  const depthRounds = [
    ...new Set([
      ...probes.filter((p) => p.round >= 2).map((p) => p.round),
      ...entityRounds.map((e) => e.round),
      ...reading.map((r) => r.round),
      ...dryRounds.map((d) => d.round),
    ]),
  ].sort((a, b) => a - b)

  // Classification is interleaved per round. A round's classify step is "active"
  // only while it's the newest round being classified and nothing later has begun.
  const classifiedInRound = (round: number) => classified.filter((s) => s.round === round)
  const maxClassifiedRound = classified.reduce((m, s) => Math.max(m, s.round), 0)
  const laterActivity = (round: number) =>
    probes.some((p) => p.round > round) ||
    entityRounds.some((e) => e.round > round) ||
    reading.some((r) => r.round > round)
  const isClassifying = (round: number) =>
    phase === "running" && round === maxClassifiedRound && !laterActivity(round)

  // Open while working; auto-collapse once the audit finishes so the report
  // becomes the focus. Still user-toggleable afterward (onOpenChange).
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (done) setOpen(false)
  }, [done])

  return (
    <ChainOfThought open={open} onOpenChange={setOpen} className="px-1">
      <ChainOfThoughtHeader>
        {done
          ? `Audited ${classified.length} sources across ${probes.length} searches`
          : "Working…"}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {variants.length > 0 && (
          <ChainOfThoughtStep
            icon={Sparkles}
            label={`Expanded into ${variants.length} search angles`}
            status="complete"
          >
            <ChainOfThoughtSearchResults className="mt-1">
              {variants.map((v) => (
                <ChainOfThoughtSearchResult key={v}>
                  <Search data-icon="inline-start" />
                  {v}
                </ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
        )}

        {r1.length > 0 && (
          <ChainOfThoughtStep
            icon={Search}
            label={`Searched the web · ${r1.reduce((n, p) => n + p.count, 0)} results`}
            status="complete"
          >
            <ChainOfThoughtSearchResults className="mt-1">
              {r1.map((p) => (
                <ChainOfThoughtSearchResult key={p.query}>
                  <Search data-icon="inline-start" />
                  {p.query} · {p.count}
                </ChainOfThoughtSearchResult>
              ))}
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
        )}

        {/* Round 1's sources are classified before the depth loop begins. */}
        <ClassifyStep sources={classifiedInRound(1)} active={isClassifying(1)} />

        {depthRounds.map((round) => {
          const read = reading.find((r) => r.round === round)
          const ents = entityRounds.find((e) => e.round === round)?.entities ?? []
          const roundProbes = probes.filter((p) => p.round === round)
          const dry = dryRounds.find((d) => d.round === round)
          const depthLabel = depthRounds.length > 1 ? ` (round ${round})` : ""
          return (
            <Fragment key={round}>
              {read && read.count > 0 && (
                <ChainOfThoughtStep
                  icon={FileText}
                  label={`Read ${read.count} wanted source${read.count === 1 ? "" : "s"} for deeper leads${depthLabel}`}
                  status="complete"
                />
              )}
              {dry && (
                <ChainOfThoughtStep
                  icon={CircleSlash}
                  label={
                    dry.reason === "no-new-entities"
                      ? `No new leads to probe${depthLabel} — every source pointed back to what's already been searched`
                      : `No new wanted sources came back${depthLabel} — the good stuff has dried up`
                  }
                  status="complete"
                />
              )}
              {ents.length > 0 && (
                <ChainOfThoughtStep
                  icon={Telescope}
                  label={`Pulled out ${ents.length} entit${ents.length === 1 ? "y" : "ies"} to probe${depthLabel}`}
                  status="complete"
                >
                  <ChainOfThoughtSearchResults className="mt-1">
                    {ents.map((e) => (
                      <ChainOfThoughtSearchResult key={e}>
                        <Telescope data-icon="inline-start" />
                        {e}
                      </ChainOfThoughtSearchResult>
                    ))}
                  </ChainOfThoughtSearchResults>
                </ChainOfThoughtStep>
              )}
              {roundProbes.length > 0 && (
                <ChainOfThoughtStep
                  icon={Search}
                  label={`Probed entities · ${roundProbes.reduce((n, p) => n + p.count, 0)} results${depthLabel}`}
                  status="complete"
                >
                  <ChainOfThoughtSearchResults className="mt-1">
                    {roundProbes.map((p) => (
                      <ChainOfThoughtSearchResult key={p.query}>
                        <Search data-icon="inline-start" />
                        {p.query} · {p.count}
                      </ChainOfThoughtSearchResult>
                    ))}
                  </ChainOfThoughtSearchResults>
                </ChainOfThoughtStep>
              )}
              {/* This round's sources are classified right after its probes. */}
              <ClassifyStep sources={classifiedInRound(round)} active={isClassifying(round)} />
            </Fragment>
          )
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

/** The final deliverable: gaps callout + per-category breakdown with sources. */
function ReportView({ report }: { report: CoverageReport }) {
  // Wanted categories first (the ones the user asked for), then by count desc.
  const populated = report.byCategory
    .filter((c) => c.count > 0)
    .sort((a, b) => Number(b.wanted) - Number(a.wanted) || b.count - a.count)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      <p className="text-sm text-muted-foreground">
        Ran {report.searchCount ?? report.queriesRun.length} searches
        {report.roundsRun ? ` across ${report.roundsRun} round${report.roundsRun === 1 ? "" : "s"}` : ""}
        {report.scrapeCount ? ` (+${report.scrapeCount} page reads)` : ""}
        {report.elapsedMs ? ` in ${formatDuration(report.elapsedMs)}` : ""}, found{" "}
        {report.totalSourcesFound} unique sources, filtered out {report.droppedCount} not
        matching this profile.
        {report.stopReason && (
          <>
            {" "}
            <span className="text-foreground">
              {report.stopReason === "saturated"
                ? "Stopped when new wanted sources dried up."
                : "Stopped at the depth ceiling — bump the preset for more."}
            </span>
          </>
        )}
      </p>

      {report.gaps.length > 0 ? (
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <TriangleAlert className="size-3.5 text-amber-500" />
            Gaps: wanted categories with zero results
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {report.gaps.map((c) => (
              <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                {titleCaseCategory(c)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-lime-500/5 px-3 py-2.5 text-sm text-lime-700 dark:text-lime-400">
          Every wanted category has at least one result.
        </div>
      )}

      <div className="space-y-5">
        {populated.map((c) => (
          <div key={c.category} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">
                {titleCaseCategory(c.category)}
              </h4>
              <span className="text-sm text-muted-foreground/60">•</span>
              <span className="font-mono text-sm text-muted-foreground">{c.count}</span>
              {c.wanted && (
                <span
                  className="size-2 shrink-0 rounded-full bg-primary"
                  aria-label="wanted"
                />
              )}
            </div>
            <div className="space-y-2">
              {c.sources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0 rounded-sm"
                    style={{
                      backgroundImage: `url(${faviconUrl(s.url)})`,
                      backgroundPosition: "center",
                      backgroundRepeat: "no-repeat",
                      backgroundSize: "contain",
                    }}
                  />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {s.title || domainOf(s.url)}
                    </span>
                    <span className="block text-xs leading-snug text-muted-foreground">
                      {s.justification ||
                        (c.wanted ? "Matches this source type." : "Filtered — not a wanted source type.")}
                      {!s.extractable && " · flagged for manual review"}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export function EmberSearch() {
  const [profileId, setProfileId] = useState("")
  const [taxonomy, setTaxonomy] = useState<TaxonomyCategory[]>([])
  const [include, setInclude] = useState<Set<string>>(new Set())
  const [effort, setEffort] = useState<EffortPreset>("standard")
  const [phase, setPhase] = useState<Phase>("idle")
  const [query, setQuery] = useState("")
  const [variants, setVariants] = useState<string[]>([])
  const [probes, setProbes] = useState<{ query: string; round: number; count: number }[]>([])
  const [entityRounds, setEntityRounds] = useState<{ round: number; entities: string[] }[]>([])
  const [reading, setReading] = useState<{ round: number; count: number }[]>([])
  const [dryRounds, setDryRounds] = useState<
    { round: number; reason: "no-new-entities" | "no-new-wanted" }[]
  >([])
  const [classifyTotal, setClassifyTotal] = useState(0)
  const [classified, setClassified] = useState<ClassifiedSourceEvent[]>([])
  const [report, setReport] = useState<CoverageReport | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/audits")
        const data = (await res.json()) as {
          profiles: ProfileSummary[]
          taxonomy: TaxonomyCategory[]
          defaultInclude: string[]
        }
        const taxo = data.taxonomy ?? []
        const validIds = new Set(taxo.map((c) => c.id))
        setProfileId((cur) => cur || data.profiles[0]?.id || "")
        setTaxonomy(taxo)

        // Prefer a previously-saved rubric; fall back to the server default.
        // Filter against the live taxonomy so a stale saved id can't linger.
        let initial = (data.defaultInclude ?? []).filter((id) => validIds.has(id))
        try {
          const saved = localStorage.getItem(SOURCES_STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved)
            if (Array.isArray(parsed)) initial = parsed.filter((id) => validIds.has(id))
          }
        } catch {
          // corrupt/blocked storage — just use the default
        }
        setInclude(new Set(initial))
      } catch {
        // leave empty; submit will surface the error
      } finally {
        try {
          const savedEffort = localStorage.getItem(EFFORT_STORAGE_KEY)
          if (isEffortPreset(savedEffort)) setEffort(savedEffort)
        } catch {
          // ignore
        }
        setLoaded(true)
      }
    })()
  }, [])

  // Persist the wanted-set whenever it changes (but not before initial load,
  // so we never clobber saved state with the empty starting value).
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify([...include]))
    } catch {
      // storage full/blocked — non-fatal
    }
  }, [include, loaded])

  // Persist the chosen depth preset the same way.
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(EFFORT_STORAGE_KEY, effort)
    } catch {
      // non-fatal
    }
  }, [effort, loaded])

  const toggleInclude = useCallback((id: string) => {
    setInclude((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const runAudit = useCallback(
    async (q: string) => {
      // Cancel any in-flight run so a new search started from the compact bar
      // cleanly supersedes the previous one.
      abortRef.current?.abort()
      // Reset transient state but keep the query + running phase visible.
      setQuery(q)
      setVariants([])
      setProbes([])
      setEntityRounds([])
      setReading([])
      setDryRounds([])
      setClassifyTotal(0)
      setClassified([])
      setReport(null)
      setErrorMsg(null)
      setPhase("running")

      const controller = new AbortController()
      abortRef.current = controller
      try {
        const res = await fetch("/api/audit-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, profileId, include: [...include], effort }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          setErrorMsg(data.error ?? "Could not start the audit.")
          setPhase("error")
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        for (; ;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line)
            switch (event.type) {
              case "expand":
                setVariants(event.variants)
                break
              case "probe":
                setProbes((p) => [...p, { query: event.query, round: event.round, count: event.sources.length }])
                break
              case "reading":
                setReading((r) => [...r, { round: event.round, count: event.count }])
                break
              case "dry":
                setDryRounds((d) => [...d, { round: event.round, reason: event.reason }])
                break
              case "entities":
                setEntityRounds((e) => [...e, { round: event.round, entities: event.entities }])
                break
              case "classifyStart":
                setClassifyTotal(event.total)
                break
              case "classified":
                setClassified((c) => [...c, { ...event.source, round: event.round }])
                break
              case "report":
                setReport(event.report)
                setPhase("done")
                break
              case "error":
                setErrorMsg(event.error)
                setPhase("error")
                break
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setErrorMsg("Lost connection to the audit stream.")
          setPhase("error")
        }
      }
    },
    [profileId, include, effort]
  )

  // Bumped on reset to remount the composer so its internal draft clears too —
  // clicking the logo returns to the original blank homepage slate.
  const [resetKey, setResetKey] = useState(0)
  const reset = useCallback(() => {
    abortRef.current?.abort()
    setPhase("idle")
    setQuery("")
    setVariants([])
    setProbes([])
    setEntityRounds([])
    setReading([])
    setDryRounds([])
    setClassifyTotal(0)
    setClassified([])
    setReport(null)
    setErrorMsg(null)
    setResetKey((k) => k + 1)
  }, [])

  const idle = phase === "idle"

  return (
    <main className="relative isolate min-h-svh overflow-x-hidden bg-background">
      <div className="absolute top-4 right-4 z-30">
        <ThemeSelect />
      </div>
      <MeshBackdrop active={!idle} />

      <LayoutGroup>
        <div
          className={cn(
            "relative z-10 mx-auto flex min-h-svh w-full max-w-3xl flex-col px-6",
            idle ? "justify-center py-8" : "gap-6 pt-16 pb-24"
          )}
        >
          {/* Header block: centered logo + the same composer, idle or not. When
              idle, pb-[12svh] biases the centered block a bit high. */}
          <motion.div
            layout
            className={cn(
              "flex flex-col items-center gap-6 sm:gap-8",
              idle && "pb-[12svh]"
            )}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <button
              type="button"
              onClick={reset}
              aria-label="Back to start"
              className="rounded-lg outline-none transition duration-300 ease-out hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
            >
              <EmberLogo />
            </button>
            <SearchBox
              key={resetKey}
              taxonomy={taxonomy}
              include={include}
              onToggleInclude={toggleInclude}
              effort={effort}
              onEffortChange={setEffort}
              onSubmit={runAudit}
              disabled={phase === "running"}
            />
            {errorMsg && idle && (
              <p className="text-sm text-destructive" role="alert">
                {errorMsg}
              </p>
            )}
          </motion.div>

          {/* Live accordion + report */}
          <AnimatePresence>
            {!idle && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4"
              >
                <ThinkingAccordion
                  phase={phase}
                  variants={variants}
                  probes={probes}
                  entityRounds={entityRounds}
                  reading={reading}
                  dryRounds={dryRounds}
                  classified={classified}
                />
                {phase === "error" && (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMsg}
                  </p>
                )}
                {report && <ReportView report={report} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </main>
  )
}
