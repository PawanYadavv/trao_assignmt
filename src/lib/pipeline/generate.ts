import { findUncoveredRequirements } from "@/lib/kit/coverage";
import { buildSchedule } from "@/lib/kit/schedule";
import { validateKit } from "@/lib/kit/validate";
import type { Kit, Requirement } from "@/lib/kit/types";
import type { RetrievedPage } from "./retrieve";
import { extractRequirementsWithLlm } from "./llm";

function extractRequirements(jd: string): Requirement[] {
  const lines = jd.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const signals = lines.filter((line) => /react|typescript|javascript|python|node|sql|years|collaborat|communicat|mentor|design|test|lead/i.test(line));
  return (signals.length ? signals : lines.slice(0, 3)).slice(0, 8).map((text, index) => ({
    id: `r${index + 1}`,
    text: text.replace(/^[-*•]\s*/, '').slice(0, 180),
    kind: /collaborat|communicat|mentor|lead/i.test(text) ? 'behavioural' : /design|domain/i.test(text) ? 'domain' : 'technical',
    priority: /nice|bonus|preferred|plus/i.test(text) ? 'nice' : 'must',
  }));
}

export async function generateKit(input: { jd: string; company_url: string; days: number }, research: { pages: RetrievedPage[]; warnings: string[] }): Promise<Kit> {
  let requirements: Requirement[];
  try {
    const llmRequirements = await extractRequirementsWithLlm(input.jd);
    requirements = llmRequirements?.map((requirement, index) => ({ id: `r${index + 1}`, ...requirement })) ?? extractRequirements(input.jd);
  } catch {
    requirements = extractRequirements(input.jd);
  }
  const initialQuestions = requirements.map((requirement, index) => ({
    id: `q${index + 1}`,
    requirement_ids: [requirement.id],
    category: requirement.kind === 'behavioural' ? 'behavioural' as const : requirement.kind === 'domain' ? 'company-fit' as const : 'technical' as const,
    prompt: `How would you demonstrate strength in: ${requirement.text}?`,
    answer_outline: `Use a concrete example. Explain your approach, trade-offs, measurable outcome, and what you learned about ${requirement.text}.`,
    difficulty: requirement.priority === 'must' ? 3 as const : 2 as const,
    state: 'generated' as const,
  }));
  const uncovered = findUncoveredRequirements(requirements, initialQuestions);
  const questions = [...initialQuestions, ...uncovered.map((id, index) => ({ id: `q${initialQuestions.length + index + 1}`, requirement_ids: [id], category: 'technical' as const, prompt: `Tell us about your experience with ${requirements.find((item) => item.id === id)?.text}.`, answer_outline: 'Give a specific example and connect it to the role.', difficulty: 3 as const, state: 'generated' as const }))];
  const company = new URL(input.company_url).hostname.replace(/^www\./, '').split('.')[0];
  const kit: Kit = {
    source: { company, company_url: input.company_url, role: 'Interview preparation', location: 'Not specified', jd_chars: input.jd.length, researched_at: new Date().toISOString(), pages_used: research.pages.map((page) => page.url) },
    company_brief: { summary: research.pages.some((page) => page.text) ? `Research gathered from ${research.pages.length} public page${research.pages.length === 1 ? '' : 's'} for ${company}.` : 'The company website did not provide enough information for a reliable summary.', what_they_do: research.pages.find((page) => page.text)?.text.slice(0, 320) ?? 'The company website did not provide enough information for a reliable summary.', sources: research.pages.map((page) => page.url) },
    role: { title: 'Interview preparation', seniority: 'Not specified', responsibilities: ['Review the job description and prepare concrete examples.'], requirements },
    questions,
    flashcards: requirements.map((requirement, index) => ({ id: `f${index + 1}`, front: `What evidence can you share for: ${requirement.text}?`, back: 'Prepare one concise story with context, action, result, and reflection.', requirement_ids: [requirement.id], state: 'generated' as const })),
    schedule: buildSchedule(requirements, questions, input.days),
    coverage: { uncovered_requirement_ids: findUncoveredRequirements(requirements, questions), passes: 2 },
  };
  const errors = validateKit(kit);
  if (errors.length) throw new Error(errors.join(' '));
  return kit;
}
