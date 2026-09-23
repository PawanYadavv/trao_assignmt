/**
 * Flashcards are derived from requirements rather than from questions, so that
 * recall practice tracks the job description directly.
 */

import type { Flashcard, Requirement } from "@/lib/kit/types";
import { askForJson } from "./llm";

export type FlashcardDraft = Omit<Flashcard, "id">;

function templateCard(requirement: Requirement): FlashcardDraft {
  const text = requirement.text.replace(/\.$/, "");
  return {
    front:
      requirement.kind === "behavioural"
        ? `Which story do you tell for: ${text}?`
        : `What do you need to be able to say about: ${text}?`,
    back:
      requirement.kind === "behavioural"
        ? "One situation, the action you took, the outcome, and what you changed afterwards. Keep it under two minutes."
        : `The core concept, one example from your own work, and the trade-off you would raise. Be ready for a follow-up on ${text}.`,
    requirement_ids: [requirement.id],
    state: "generated",
  };
}

function parseCards(value: unknown, requirements: Requirement[]): FlashcardDraft[] | null {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { flashcards?: unknown })?.flashcards)
      ? (value as { flashcards: unknown[] }).flashcards
      : null;
  if (!list) return null;

  const validIds = new Set(requirements.map((requirement) => requirement.id));
  const drafts = list.flatMap((item): FlashcardDraft[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const front = typeof record.front === "string" ? record.front.trim() : "";
    const back = typeof record.back === "string" ? record.back.trim() : "";
    if (front.length < 8 || back.length < 8) return [];
    const ids = Array.isArray(record.requirement_ids)
      ? record.requirement_ids.filter((id): id is string => typeof id === "string" && validIds.has(id))
      : [];
    return [{
      front: front.slice(0, 300),
      back: back.slice(0, 600),
      requirement_ids: ids.length ? ids : [requirements[0].id],
      state: "generated",
    }];
  });

  return drafts.length ? drafts : null;
}

export async function generateFlashcards(
  requirements: Requirement[],
  roleTitle: string,
): Promise<{ drafts: FlashcardDraft[]; usedModel: boolean }> {
  if (!requirements.length) return { drafts: [], usedModel: false };

  const requirementList = requirements
    .map((requirement) => `${requirement.id} (${requirement.priority}): ${requirement.text}`)
    .join("\n");

  try {
    const drafts = await askForJson<FlashcardDraft[]>({
      instruction: [
        `Write one recall flashcard per requirement for a ${roleTitle} interview.`,
        "The front is a question the candidate should be able to answer from memory in under a minute.",
        "The back is the compact answer they should be able to give - specific, not a definition of the term.",
        "Set requirement_ids to the requirement the card drills.",
        "",
        "Requirements:",
        requirementList,
      ].join("\n"),
      untrusted: [],
      schemaHint: 'Respond with {"flashcards": [{"requirement_ids": string[], "front": string, "back": string}]}.',
      parse: (value) => parseCards(value, requirements),
      maxTokens: 1800,
    });

    if (drafts) return { drafts, usedModel: true };
  } catch {
    // fall through to templates
  }

  return { drafts: requirements.map(templateCard), usedModel: false };
}

export function templateFlashcards(requirements: Requirement[]): FlashcardDraft[] {
  return requirements.map(templateCard);
}
