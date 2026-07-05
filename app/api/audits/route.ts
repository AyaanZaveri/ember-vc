import { z } from "zod"

import { listJobs, listProfiles, startJob } from "@/lib/completeness/job-store.ts"
import { DEMO_PROFILE } from "@/lib/completeness/profile.ts"

const startSchema = z.object({
  query: z.string().trim().min(1, "Query is required.").max(300),
  profileId: z.string().trim().min(1),
})

export async function GET() {
  return Response.json({
    profiles: listProfiles(),
    jobs: listJobs().map(toJobSummary),
    // The source-type taxonomy + the default wanted-set, so the front-end picker
    // can render every togglable category with its description.
    taxonomy: DEMO_PROFILE.categories,
    defaultInclude: DEMO_PROFILE.include,
  })
}

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten().fieldErrors.query?.[0] ?? "Invalid request." },
      { status: 400 }
    )
  }

  if (!process.env.FIRECRAWL_API_KEY || !process.env.NVIDIA_NIM_API_KEY) {
    return Response.json(
      { error: "FIRECRAWL_API_KEY or NVIDIA_NIM_API_KEY is not configured." },
      { status: 500 }
    )
  }

  try {
    const job = startJob({
      query: parsed.data.query,
      profileId: parsed.data.profileId,
      createdAt: Date.now(),
    })
    return Response.json({ job: toJobSummary(job) }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start audit." },
      { status: 400 }
    )
  }
}

/** List view never needs the full report payload — keep it light. */
function toJobSummary(job: ReturnType<typeof listJobs>[number]) {
  return {
    id: job.id,
    query: job.query,
    profileId: job.profileId,
    status: job.status,
    createdAt: job.createdAt,
    gapCount: job.report?.gaps.length ?? null,
    thinCount: job.report?.thin.length ?? null,
    totalSourcesFound: job.report?.totalSourcesFound ?? null,
    error: job.error ?? null,
  }
}
