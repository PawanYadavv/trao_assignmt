import { getCurrentUser } from "@/lib/auth";
import { assertValidKit } from "@/lib/kit/validate";
import { runPipeline, type ProgressEvent } from "@/lib/pipeline/generate";
import { RetrievalError } from "@/lib/pipeline/retrieve";
import { createKit, fingerprintFor, findByFingerprint, listKits, summarise } from "@/lib/store/kits";
import { apiError, jsonError, readJson, unauthorised } from "@/lib/http";

// Generation is slow and external; give it the whole function budget.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorised();
  try {
    return Response.json({ kits: await listKits(user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

interface CreateBody {
  jd?: unknown;
  company_url?: unknown;
  days?: unknown;
}

function validateBody(body: CreateBody) {
  const jd = typeof body.jd === "string" ? body.jd.trim() : "";
  if (jd.length < 10) {
    return { error: apiError("INVALID_JD", "Paste a job description of at least 10 characters.", 400) };
  }
  if (jd.length > 60_000) {
    return { error: apiError("INVALID_JD", "That job description is too long (60,000 character limit).", 400) };
  }
  if (typeof body.company_url !== "string" || !body.company_url.trim()) {
    return { error: apiError("INVALID_URL", "Add the company's website address.", 400) };
  }
  const days = typeof body.days === "number" ? body.days : Number(body.days);
  if (!Number.isFinite(days) || days < 1 || days > 60) {
    return { error: apiError("INVALID_DAYS", "Days until the interview must be between 1 and 60.", 400) };
  }
  return { value: { jd, company_url: body.company_url.trim(), days: Math.floor(days) } };
}

/**
 * Creates a kit, streaming progress as newline-delimited JSON so the client can
 * show which step is running rather than a ninety-second spinner. The final
 * line is either `{"type":"done"}` or `{"type":"error"}`.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorised();

  const parsed = await readJson<CreateBody>(request);
  if ("error" in parsed) return parsed.error;

  const checked = validateBody(parsed.value);
  if ("error" in checked) return checked.error;
  const input = checked.value;

  // The same description and company submitted twice returns the existing kit
  // rather than paying for a second generation.
  const fingerprint = fingerprintFor(input);
  try {
    const existing = await findByFingerprint(user.id, fingerprint);
    if (existing) {
      return Response.json({ record: summarise(existing), kit: existing.kit, duplicate: true });
    }
  } catch (error) {
    return jsonError(error);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));

      try {
        const onProgress = (event: ProgressEvent) => send({ type: "progress", ...event });
        const kit = await runPipeline(input, onProgress);
        assertValidKit(kit);

        const record = await createKit(user.id, kit, fingerprint);
        send({ type: "done", record: summarise(record), kit: record.kit });
      } catch (error) {
        const code = error instanceof RetrievalError ? error.code : "GENERATION_FAILED";
        send({
          type: "error",
          error: { code, message: error instanceof Error ? error.message : "Could not generate the kit." },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
