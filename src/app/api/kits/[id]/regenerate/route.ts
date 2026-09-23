import { getCurrentUser } from "@/lib/auth";
import { isRegenerableSection, mergeRegeneratedCategory, reconcileKit } from "@/lib/kit/merge";
import { buildSchedule, clampDays } from "@/lib/kit/schedule";
import type { Kit, QuestionCategory } from "@/lib/kit/types";
import { validateKit } from "@/lib/kit/validate";
import { apiError, jsonError, notFound, readJson, unauthorised } from "@/lib/http";
import { getKit, summarise, updateKit } from "@/lib/store/kits";
import { buildCompanyBrief, NO_HIRING_INFO } from "@/lib/pipeline/brief";
import { generateQuestionsForCategory, type GenerationContext } from "@/lib/pipeline/questions";
import { companyNameFromUrl, researchCompany, validateCompanyUrl } from "@/lib/pipeline/retrieve";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function contextFor(kit: Kit): GenerationContext {
  const hiring = kit.company_brief.how_they_hire;
  return {
    company: kit.source.company,
    roleTitle: kit.role.title,
    seniority: kit.role.seniority,
    hiringProcess: hiring && hiring !== NO_HIRING_INFO ? hiring : null,
    companySummary: kit.company_brief.what_they_do || null,
  };
}

/**
 * Regenerates exactly one section. Everything outside that section is left
 * byte-for-byte alone, and inside it every edited, authored or pinned item
 * survives - see `lib/kit/merge.ts` for the rule.
 */
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorised();

  const parsed = await readJson<{ section?: unknown; days?: unknown }>(request);
  if ("error" in parsed) return parsed.error;

  const section = parsed.value.section;
  if (typeof section !== "string" || !isRegenerableSection(section)) {
    return apiError("INVALID_SECTION", "That section cannot be regenerated on its own.", 400);
  }

  try {
    const { id } = await params;
    const existing = await getKit(user.id, id);
    if (!existing) return notFound();

    const kit = existing.kit;
    let next: Kit;

    if (section === "company_brief") {
      if (kit.company_brief.state === "pinned") {
        return apiError("SECTION_PINNED", "Unpin the company brief before regenerating it.", 409);
      }
      const url = validateCompanyUrl(kit.source.company_url);
      const research = await researchCompany(kit.source.company_url);
      const { brief } = await buildCompanyBrief(companyNameFromUrl(url), research);
      next = {
        ...kit,
        company_brief: brief,
        source: { ...kit.source, pages_used: research.pages.map((page) => page.url), researched_at: new Date().toISOString() },
        warnings: [...new Set([...(kit.warnings ?? []), ...research.warnings])],
      };
    } else if (section === "schedule") {
      if (kit.schedule.state === "pinned") {
        return apiError("SECTION_PINNED", "Unpin the schedule before regenerating it.", 409);
      }
      const requestedDays = typeof parsed.value.days === "number" ? parsed.value.days : kit.schedule.days_available;
      const days = clampDays(requestedDays);
      next = {
        ...kit,
        schedule: { ...buildSchedule(kit.role.requirements, kit.questions, days), state: "generated" },
      };
    } else {
      const category = section as QuestionCategory;
      const requirementIds = new Set(
        kit.questions.filter((question) => question.category === category).flatMap((question) => question.requirement_ids),
      );
      const requirements = kit.role.requirements.filter((requirement) => requirementIds.has(requirement.id));
      if (!requirements.length) {
        return apiError("NOTHING_TO_REGENERATE", `No ${category} questions are linked to a requirement.`, 400);
      }

      const { drafts } = await generateQuestionsForCategory(requirements, category, contextFor(kit));
      next = { ...kit, questions: mergeRegeneratedCategory(kit.questions, category, drafts) };
    }

    const reconciled = reconcileKit(next);
    const errors = validateKit(reconciled);
    if (errors.length) {
      return apiError("INVALID_KIT", `Regeneration produced an invalid kit: ${errors.slice(0, 3).join(" ")}`, 422);
    }

    const saved = await updateKit(user.id, id, reconciled);
    if (!saved) return notFound();
    return Response.json({ record: summarise(saved), kit: saved.kit, section });
  } catch (error) {
    return jsonError(error);
  }
}
