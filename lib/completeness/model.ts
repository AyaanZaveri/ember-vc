import { ModelIdSchema, type ModelId } from "../ai/models.ts"

/**
 * The NIM model used across the completeness pipeline (classification, query
 * expansion, entity extraction, category vocab). One shared resolution so
 * classify.ts and discover.ts can't silently drift onto different models.
 *
 * Chosen by latency, tested empirically against the actual classify.ts task
 * shape (a real ~0.8-5s spread per call, and classification runs once per
 * unique source, so it dominates wall-clock):
 *   mistralai/ministral-14b-instruct-2512   ~800ms   (fastest, correct)
 *   nvidia/nemotron-3-nano-30b-a3b          ~1.1s    (correct)
 *   qwen/qwen3-next-80b-a3b-instruct        ~4.6-5s  (correct, but the old default)
 *   stepfun-ai/step-3.5-flash               ~2.1s    (unparseable output)
 *   openai/gpt-oss-120b                     timeout  (unresponsive on NIM)
 *
 * EMBER_NIM_MODEL_ID overrides this without a code change. Validated against
 * the same ModelId union the rest of the app uses; unset or invalid falls back
 * to the tested default below rather than passing an unchecked string through.
 */
export const DEFAULT_COMPLETENESS_MODEL_ID: ModelId = "mistralai/ministral-14b-instruct-2512"

function resolveModelId(): ModelId {
  const parsed = ModelIdSchema.safeParse(process.env.EMBER_NIM_MODEL_ID)
  return parsed.success ? parsed.data : DEFAULT_COMPLETENESS_MODEL_ID
}

export const COMPLETENESS_MODEL_ID = resolveModelId()
