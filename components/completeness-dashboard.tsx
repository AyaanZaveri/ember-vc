"use client"

import { MeshGradient } from "@paper-design/shaders-react"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  Telescope,
  TriangleAlert,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { FirecrawlHeat } from "@/components/fc-heat"
import { useTheme } from "@/components/theme-provider"
import { ThemeSelect } from "@/components/theme-select"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type JobStatus = "queued" | "discovering" | "classifying" | "done" | "error"

type JobSummary = {
  id: string
  query: string
  profileId: string
  status: JobStatus
  createdAt: number
  gapCount: number | null
  thinCount: number | null
  totalSourcesFound: number | null
  error: string | null
}

type ProfileSummary = {
  id: string
  include: string[]
  categoryCount: number
}

type CategoryBreakdown = {
  category: string
  wanted: boolean
  count: number
  sources: { url: string; title: string; confidence: string; extractable: boolean }[]
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
}

type FullJob = JobSummary & { report?: CoverageReport }

const ACTIVE_STATUSES: JobStatus[] = ["queued", "discovering", "classifying"]

function isActive(status: JobStatus) {
  return ACTIVE_STATUSES.includes(status)
}

function statusLabel(status: JobStatus) {
  switch (status) {
    case "queued":
      return "Queued"
    case "discovering":
      return "Discovering sources…"
    case "classifying":
      return "Classifying sources…"
    case "done":
      return "Done"
    case "error":
      return "Failed"
  }
}

function prettyCategory(id: string) {
  return id.replace(/_/g, " ")
}

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

function MeshBackdrop({ hasRuns }: { hasRuns: boolean }) {
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
          animate={{ opacity: hasRuns ? (isDark ? 0.18 : 0.28) : isDark ? 0.32 : 0.58 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className={cn(
            "pointer-events-none fixed inset-x-0 z-0 overflow-hidden",
            hasRuns ? "top-0 h-[24rem]" : "inset-y-0"
          )}
          style={
            hasRuns
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
              background: hasRuns
                ? `radial-gradient(ellipse at top, transparent 0%, var(--background) 78%)`
                : `radial-gradient(circle, transparent 16%, var(--background) 92%)`,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function AuditComposer({
  profiles,
  profileId,
  setProfileId,
  onSubmit,
  isSubmitting,
}: {
  profiles: ProfileSummary[]
  profileId: string
  setProfileId: (id: string) => void
  onSubmit: (query: string) => void
  isSubmitting: boolean
}) {
  const [value, setValue] = useState("")
  const activeProfile = profiles.find((p) => p.id === profileId)

  const submit = () => {
    const query = value.trim()
    if (!query || isSubmitting) return
    onSubmit(query)
    setValue("")
  }

  return (
    <motion.div
      layout
      layoutId="ember-composer"
      className="mx-auto w-full max-w-3xl"
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[0_24px_80px_rgba(0,0,0,0.18)] shadow-primary/5 backdrop-blur-sm transition-colors duration-300 ease-in focus-within:border-border dark:shadow-primary/10">
        <Textarea
          rows={2}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="Audit a topic for completeness…"
          className="min-h-20 resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-base! leading-7 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between px-4 pb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full px-2.5!"
              >
                <Telescope data-icon="inline-start" className="sm:mr-0.5" />
                <span className="hidden sm:inline">
                  {activeProfile ? prettyCategory(activeProfile.id) : "Profile"}
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={10} className="min-w-64">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup value={profileId} onValueChange={setProfileId}>
                  {profiles.map((profile) => (
                    <DropdownMenuRadioItem key={profile.id} value={profile.id}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{prettyCategory(profile.id)}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          wants: {profile.include.map(prettyCategory).join(", ")}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="icon-sm"
            className="rounded-full"
            aria-label="Start audit"
            disabled={isSubmitting}
            onClick={submit}
          >
            {isSubmitting ? (
              <LoaderCircle data-icon className="animate-spin" />
            ) : (
              <ArrowUp data-icon />
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

function StatusBadge({ job }: { job: JobSummary }) {
  if (isActive(job.status)) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        {statusLabel(job.status)}
      </span>
    )
  }
  if (job.status === "error") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle className="size-3.5" />
        Failed
      </span>
    )
  }
  const hasGaps = (job.gapCount ?? 0) > 0
  return (
    <span className="flex items-center gap-1.5 text-sm text-foreground">
      {hasGaps ? (
        <TriangleAlert className="size-3.5 text-amber-500" />
      ) : (
        <CheckCircle2 className="size-3.5 text-lime-500" />
      )}
      {hasGaps
        ? `${job.gapCount} gap${job.gapCount === 1 ? "" : "s"}`
        : "Complete coverage"}
    </span>
  )
}

function ReportDetail({ report }: { report: CoverageReport }) {
  const populated = report.byCategory.filter((c) => c.count > 0)
  return (
    <div className="space-y-4 border-t border-border/60 px-4 py-4">
      <p className="text-sm text-muted-foreground">
        Ran {report.queriesRun.length} search variants/entity probes, found{" "}
        {report.totalSourcesFound} unique sources, filtered out {report.droppedCount}{" "}
        not matching this profile.
      </p>

      {report.gaps.length > 0 ? (
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <TriangleAlert className="size-3.5 text-amber-500" />
            Gaps — wanted categories with zero results
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {report.gaps.map((category) => (
              <span
                key={category}
                className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
              >
                {prettyCategory(category)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-lime-500/30 bg-lime-500/5 px-3 py-2.5 text-sm text-lime-700 dark:text-lime-400">
          Every wanted category has at least one result.
        </div>
      )}

      <div className="space-y-3">
        {populated.map((c) => (
          <div key={c.category}>
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className="font-medium text-foreground">{prettyCategory(c.category)}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs",
                  c.wanted
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {c.wanted ? "wanted" : "filtered"}
              </span>
              <span className="text-xs text-muted-foreground">{c.count}</span>
            </div>
            <div className="flex flex-col gap-0.5 pl-1">
              {c.sources.slice(0, 6).map((source) => (
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
    </div>
  )
}

function RunCard({ job }: { job: JobSummary }) {
  const [expanded, setExpanded] = useState(false)
  const [report, setReport] = useState<CoverageReport | null>(null)
  const [loading, setLoading] = useState(false)
  const canExpand = job.status === "done"

  const toggle = useCallback(async () => {
    if (!canExpand) return
    const next = !expanded
    setExpanded(next)
    if (next && !report) {
      setLoading(true)
      try {
        const res = await fetch(`/api/audits/${job.id}`)
        const data = (await res.json()) as { job?: FullJob }
        if (data.job?.report) setReport(data.job.report)
      } finally {
        setLoading(false)
      }
    }
  }, [canExpand, expanded, report, job.id])

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60 backdrop-blur-sm">
      <button
        type="button"
        onClick={toggle}
        disabled={!canExpand}
        className={cn(
          "flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors",
          canExpand && "hover:bg-accent/40"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{job.query}</span>
          <span className="text-xs text-muted-foreground">{prettyCategory(job.profileId)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <StatusBadge job={job} />
          {canExpand && (
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
            />
          )}
        </span>
      </button>
      {expanded && loading && (
        <div className="flex items-center gap-2 border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Loading report…
        </div>
      )}
      {expanded && report && <ReportDetail report={report} />}
    </div>
  )
}

export function CompletenessDashboard() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [profileId, setProfileId] = useState<string>("")
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/audits")
      const data = (await res.json()) as { profiles: ProfileSummary[]; jobs: JobSummary[] }
      setProfiles(data.profiles)
      setJobs(data.jobs)
      setProfileId((current) => current || data.profiles[0]?.id || "")
    } catch {
      // transient; next poll retries
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const hasActiveJobs = jobs.some((job) => isActive(job.status))

  // Poll while anything is running so statuses update live.
  useEffect(() => {
    if (!hasActiveJobs) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(() => void refresh(), 2000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [hasActiveJobs, refresh])

  const submit = useCallback(
    async (query: string) => {
      setIsSubmitting(true)
      setError(null)
      try {
        const res = await fetch("/api/audits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, profileId }),
        })
        const data = (await res.json()) as { job?: JobSummary; error?: string }
        if (!res.ok || !data.job) {
          setError(data.error ?? "Could not start audit.")
        } else {
          setJobs((current) => [data.job as JobSummary, ...current])
        }
      } catch {
        setError("Could not reach the server.")
      } finally {
        setIsSubmitting(false)
      }
    },
    [profileId]
  )

  const hasRuns = jobs.length > 0
  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => b.createdAt - a.createdAt),
    [jobs]
  )

  return (
    <main className="relative isolate min-h-svh overflow-x-hidden bg-background">
      <div className="absolute top-4 right-4 z-30">
        <ThemeSelect />
      </div>
      <MeshBackdrop hasRuns={hasRuns} />

      <LayoutGroup>
        <div
          className={cn(
            "relative z-10 mx-auto flex min-h-svh w-full max-w-3xl flex-col px-6",
            hasRuns ? "gap-8 pt-16 pb-24" : "justify-center"
          )}
        >
          <motion.div
            layout
            className="flex flex-col items-center gap-6"
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <EmberLogo />
            {!hasRuns && (
              <p className="max-w-md text-center text-sm text-muted-foreground">
                Audit a topic for source-type completeness. Ember finds what your
                search misses — the trade press, regional press, and forums that
                keyword ranking buries.
              </p>
            )}
            <AuditComposer
              profiles={profiles}
              profileId={profileId}
              setProfileId={setProfileId}
              onSubmit={submit}
              isSubmitting={isSubmitting}
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </motion.div>

          {hasRuns && (
            <div className="flex flex-col gap-2.5">
              {sortedJobs.map((job) => (
                <RunCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
      </LayoutGroup>
    </main>
  )
}
