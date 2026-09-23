/**
 * Shared request/response helpers so every endpoint returns the same structured
 * error shape: `{ error: { code, message } }`.
 */

import { RetrievalError } from "@/lib/pipeline/retrieve";

export function apiError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export function unauthorised() {
  return apiError("UNAUTHENTICATED", "Your session has expired. Please log in again.", 401);
}

export function notFound(what = "That kit") {
  return apiError("NOT_FOUND", `${what} does not exist, or is not yours.`, 404);
}

/** Maps an unexpected error to a safe, structured response. */
export function jsonError(error: unknown) {
  if (error instanceof RetrievalError) {
    const status = error.code === "INVALID_URL" || error.code === "BLOCKED_ADDRESS" ? 400 : 502;
    return apiError(error.code, error.message, status);
  }

  const message = error instanceof Error ? error.message : "";
  if (/MongoServerSelection|ECONNREFUSED|SSL|TLS|ENOTFOUND/i.test(message)) {
    return apiError(
      "DATABASE_UNAVAILABLE",
      "The database could not be reached. Check MONGODB_URI, the database user's password, and the Atlas network access list.",
      503,
    );
  }
  if (/structure validation/i.test(message)) {
    return apiError("INVALID_KIT", message, 422);
  }

  return apiError("SERVER_ERROR", "Something went wrong handling that request.", 500);
}

/** Parses a JSON body, returning a structured error instead of throwing. */
export async function readJson<T>(request: Request): Promise<{ value: T } | { error: Response }> {
  try {
    const value = (await request.json()) as T;
    if (!value || typeof value !== "object") {
      return { error: apiError("INVALID_BODY", "Request body must be a JSON object.", 400) };
    }
    return { value };
  } catch {
    return { error: apiError("INVALID_BODY", "Request body must be valid JSON.", 400) };
  }
}
