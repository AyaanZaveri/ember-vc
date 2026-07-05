import { getJob } from "@/lib/completeness/job-store.ts"

/** Full job incl. the report payload — the list endpoint omits it to stay light. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = getJob(id)

  if (!job) {
    return Response.json({ error: "Audit not found." }, { status: 404 })
  }

  return Response.json({ job })
}
