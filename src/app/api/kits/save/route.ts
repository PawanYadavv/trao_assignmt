import { NextResponse } from "next/server";
import { getCurrentUser, replaceLatestKitForUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Session missing or expired." } }, { status: 401 });
  }

  const body = (await request.json()) as { kit?: unknown };
  if (!body.kit) {
    return NextResponse.json({ error: { code: "INVALID_KIT", message: "No kit was provided." } }, { status: 400 });
  }

  const saved = await replaceLatestKitForUser(user.id, body.kit);
  return NextResponse.json({ saved });
}
