import { getCurrentUser } from "@/lib/auth";
import { reconcileKit } from "@/lib/kit/merge";
import type { Kit } from "@/lib/kit/types";
import { validateKit } from "@/lib/kit/validate";
import { apiError, jsonError, notFound, readJson, unauthorised } from "@/lib/http";
import { deleteKit, getKit, summarise, updateKit } from "@/lib/store/kits";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorised();

  try {
    const { id } = await params;
    const record = await getKit(user.id, id);
    if (!record) return notFound();
    return Response.json({ record: summarise(record), kit: record.kit });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Saves the user's version of a kit. The whole kit is sent, reconciled (so
 * coverage and the schedule follow the edits) and validated before it is
 * stored, so a client bug cannot persist a malformed kit.
 */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorised();

  const parsed = await readJson<{ kit?: Kit }>(request);
  if ("error" in parsed) return parsed.error;
  if (!parsed.value.kit || typeof parsed.value.kit !== "object") {
    return apiError("INVALID_KIT", "No kit was provided.", 400);
  }

  try {
    const { id } = await params;
    const existing = await getKit(user.id, id);
    if (!existing) return notFound();

    const reconciled = reconcileKit(parsed.value.kit);
    const errors = validateKit(reconciled);
    if (errors.length) {
      return apiError("INVALID_KIT", `That kit is not valid: ${errors.slice(0, 3).join(" ")}`, 422);
    }

    const saved = await updateKit(user.id, id, reconciled);
    if (!saved) return notFound();
    return Response.json({ record: summarise(saved), kit: saved.kit });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorised();

  try {
    const { id } = await params;
    const deleted = await deleteKit(user.id, id);
    if (!deleted) return notFound();
    return Response.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
