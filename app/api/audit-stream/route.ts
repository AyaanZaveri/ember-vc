import { z } from "zod"

import { discoverAndClassify, type DiscoveryEvent } from "@/lib/completeness/discover.ts"
import { getProfile } from "@/lib/completeness/job-store.ts"
import { profileWithInclude } from "@/lib/completeness/profile.ts"
import { buildCoverageReport } from "@/lib/completeness/report.ts"

/**
 * Streaming completeness audit. Unlike /api/audits (job-store + polling, which
 * discards the pipeline's live events), this runs discoverAndClassify WITH its
 * onEvent hook and streams every step to the client as newline-delimited JSON:
 * expand -> probe -> entities -> classifyStart -> classified (one per source) ->
 * a final { type: "report" } with the coverage report. That live event stream is
 * what the search UI renders as its "thinking" accordion — the whole point of the
 * search experience (watch the pipeline work), not a chat.
 */

export const maxDuration = 300

const requestSchema = z.object({
  query: z.string().trim().min(1, "Query is required.").max(300),
  profileId: z.string().trim().min(1),
  // Optional user-chosen wanted source types (the picker). When present it
  // overrides the preset's include set; the taxonomy itself stays fixed.
  include: z.array(z.string()).optional(),
})

type StreamEvent =
  | DiscoveryEvent
  | { type: "report"; report: ReturnType<typeof buildCoverageReport> }
  | { type: "error"; error: string }

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten().fieldErrors.query?.[0] ?? "Invalid request." },
      { status: 400 }
    )
  }

  const { query, profileId, include } = parsed.data
  const preset = getProfile(profileId)
  if (!preset) {
    return Response.json({ error: `Unknown profile: ${profileId}` }, { status: 400 })
  }
  // If the client sent a custom wanted-set, use it; otherwise the preset's.
  const profile = include ? profileWithInclude(include) : preset
  if (!process.env.FIRECRAWL_API_KEY || !process.env.NVIDIA_NIM_API_KEY) {
    return Response.json(
      { error: "FIRECRAWL_API_KEY or NVIDIA_NIM_API_KEY is not configured." },
      { status: 500 }
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      try {
        const discovery = await discoverAndClassify({
          query,
          profile,
          onEvent: (event) => send(event),
        })
        const report = buildCoverageReport({
          query,
          queriesRun: discovery.queriesRun,
          profile,
          classifiedSources: discovery.classifiedSources,
        })
        send({ type: "report", report })
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "Audit failed." })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
