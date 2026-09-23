

import { NextResponse } from "next/server";
import { getCurrentUser, listKitsForUser } from "@/lib/auth";
import { generateKit } from "@/lib/pipeline/generate";
import { researchCompany, validateCompanyUrl } from "@/lib/pipeline/retrieve";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Session missing or expired." } }, { status: 401 });
  }
  return NextResponse.json({ kits: await listKitsForUser(user.id) });
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Your session expired. Please log in again." } }, { status: 401 });
    }
    const body = await request.json() as { jd?: unknown; company_url?: unknown; days?: unknown };
    if (typeof body.jd !== 'string' || body.jd.trim().length < 10) return NextResponse.json({ error: { code: 'INVALID_JD', message: 'Add a job description with at least 10 characters.' } }, { status: 400 });
    if (typeof body.company_url !== 'string') return NextResponse.json({ error: { code: 'INVALID_URL', message: 'Add a company website URL.' } }, { status: 400 });
    validateCompanyUrl(body.company_url);
    const days = typeof body.days === 'number' ? body.days : Number(body.days);
    if (!Number.isFinite(days) || days < 1 || days > 60) return NextResponse.json({ error: { code: 'INVALID_DAYS', message: 'Days must be between 1 and 60.' } }, { status: 400 });
    const research = await researchCompany(body.company_url);
    const kit = await generateKit({ jd: body.jd, company_url: body.company_url, days }, research);
    return NextResponse.json({ kit, warnings: research.warnings });
  } catch (error) {
    return NextResponse.json({ error: { code: 'GENERATION_FAILED', message: error instanceof Error ? error.message : 'Could not generate kit.' } }, { status: 502 });
  
  }
}

