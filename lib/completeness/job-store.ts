import { discoverAndClassify } from "./discover.ts"
import { DEMO_PROFILE, type CompletenessProfile } from "./profile.ts"
import { buildCoverageReport, type CoverageReport } from "./report.ts"

/**
 * In-memory job store for completeness audits. Deliberately NOT a durable
 * queue/DB — that's a scoped decision for the demo (see one-pager). It's enough
 * to run several audits concurrently, poll their status from the UI, and read
 * finished reports. Runs are lost on server restart; a production version would
 * back this with a real job queue + persistence.
 */

export type JobStatus = "queued" | "discovering" | "classifying" | "done" | "error"

export type AuditJob = {
  id: string
  query: string
  profileId: string
  status: JobStatus
  createdAt: number
  finishedAt?: number
  report?: CoverageReport
  error?: string
}

// Module-level singleton. In Next dev the module can re-evaluate on HMR, so we
// stash it on globalThis to survive hot reloads within one server process.
const globalForJobs = globalThis as unknown as { __auditJobs?: Map<string, AuditJob> }
const jobs: Map<string, AuditJob> = globalForJobs.__auditJobs ?? new Map()
globalForJobs.__auditJobs = jobs

let counter = 0
function nextId(): string {
  counter += 1
  // Avoid Date.now()/random for determinism-friendliness; monotonic is enough here.
  return `audit_${counter}_${jobs.size}`
}

const PROFILES: Record<string, CompletenessProfile> = {
  "coffee-landscape": DEMO_PROFILE,
}

export function getProfile(profileId: string): CompletenessProfile | undefined {
  return PROFILES[profileId]
}

export function listProfiles() {
  return Object.entries(PROFILES).map(([id, profile]) => ({
    id,
    include: profile.include,
    categoryCount: profile.categories.length,
  }))
}

export function listJobs(): AuditJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function getJob(id: string): AuditJob | undefined {
  return jobs.get(id)
}

export function startJob({
  query,
  profileId,
  createdAt,
}: {
  query: string
  profileId: string
  createdAt: number
}): AuditJob {
  const profile = getProfile(profileId)
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`)
  }

  const job: AuditJob = {
    id: nextId(),
    query,
    profileId,
    status: "queued",
    createdAt,
  }
  jobs.set(job.id, job)

  // Fire-and-forget: run the pipeline in the background, mutate the job in place
  // as it progresses so pollers see live status.
  void runJob(job, profile)

  return job
}

async function runJob(job: AuditJob, profile: CompletenessProfile) {
  try {
    job.status = "discovering"
    const discovery = await discoverAndClassify({ query: job.query, profile })

    job.status = "classifying"
    // (classification already happened inside discoverAndClassify; this status
    // is a coarse UI signal, not a separate pass.)
    const report = buildCoverageReport({
      query: job.query,
      queriesRun: discovery.queriesRun,
      profile,
      classifiedSources: discovery.classifiedSources,
    })

    job.report = report
    job.status = "done"
    job.finishedAt = performance.now()
  } catch (error) {
    job.status = "error"
    job.error = error instanceof Error ? error.message : "Audit failed."
    console.error(`[job-store] audit ${job.id} failed`, error)
  }
}
