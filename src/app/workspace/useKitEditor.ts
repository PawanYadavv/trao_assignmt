"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyFlashcardEdit,
  applyQuestionEdit,
  moveQuestion as moveQuestionInKit,
  reconcileKit,
  type RegenerableSection,
} from "@/lib/kit/merge";
import type { Flashcard, ItemState, Kit, Question, QuestionCategory } from "@/lib/kit/types";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

const AUTOSAVE_DELAY_MS = 700;

/**
 * Owns the open kit.
 *
 * Every edit is applied to local state immediately so typing and reordering
 * never wait for the network; the result is written back with a debounced
 * PATCH. A regeneration flushes any pending save *first*, so the server merges
 * against the user's latest edits rather than clobbering them.
 */
export function useKitEditor(kitId: string | null, initialKit: Kit | null) {
  const [kit, setKit] = useState<Kit | null>(initialKit);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<RegenerableSection | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Kit | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  // There is deliberately no effect syncing `initialKit` into state. The owner
  // mounts this hook under `key={kitId}`, so switching kits remounts and the
  // previous kit's draft, timer and save status are discarded by React itself.

  const persist = useCallback(
    async (next: Kit) => {
      if (!kitId) return;
      setStatus("saving");
      try {
        const response = await fetch(`/api/kits/${kitId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kit: next }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message ?? "Could not save your changes.");
        }
        const payload = (await response.json()) as { kit: Kit };
        // Only adopt the server's copy when nothing newer is queued locally.
        if (!pending.current) {
          setKit(payload.kit);
          setStatus("saved");
          setError(null);
        }
      } catch (caught) {
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "Could not save your changes.");
      }
    },
    [kitId],
  );

  /** Writes any queued change out now, and resolves when the server has it. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const queued = pending.current;
    pending.current = null;
    if (queued) {
      inFlight.current = persist(queued);
    }
    await inFlight.current;
  }, [persist]);

  const update = useCallback(
    (mutate: (current: Kit) => Kit) => {
      setKit((current) => {
        if (!current) return current;
        const next = mutate(current);
        pending.current = next;
        setStatus("unsaved");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const queued = pending.current;
          pending.current = null;
          if (queued) inFlight.current = persist(queued);
        }, AUTOSAVE_DELAY_MS);
        return next;
      });
    },
    [persist],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // --- questions ------------------------------------------------------------

  const editQuestion = useCallback(
    (id: string, patch: Partial<Question>) => update((current) => applyQuestionEdit(current, id, patch)),
    [update],
  );

  const addQuestion = useCallback(
    (category: QuestionCategory) => {
      const id = `q-new-${Date.now()}`;
      update((current) =>
        reconcileKit({
          ...current,
          questions: [
            ...current.questions,
            {
              id,
              requirement_ids: current.role.requirements[0] ? [current.role.requirements[0].id] : [],
              category,
              prompt: "New question",
              answer_outline: "Outline the answer you want to be able to give.",
              difficulty: 2,
              state: "authored",
            },
          ],
        }),
      );
      return id;
    },
    [update],
  );

  const deleteQuestion = useCallback(
    (id: string) =>
      update((current) => reconcileKit({ ...current, questions: current.questions.filter((q) => q.id !== id) })),
    [update],
  );

  const moveQuestion = useCallback(
    (id: string, toIndex: number, toCategory?: QuestionCategory) =>
      update((current) => moveQuestionInKit(current, id, toIndex, toCategory)),
    [update],
  );

  const setQuestionState = useCallback(
    (id: string, state: ItemState) =>
      update((current) =>
        reconcileKit({
          ...current,
          questions: current.questions.map((q) => (q.id === id ? { ...q, state } : q)),
        }),
      ),
    [update],
  );

  // --- flashcards -----------------------------------------------------------

  const editFlashcard = useCallback(
    (id: string, patch: Partial<Flashcard>) => update((current) => applyFlashcardEdit(current, id, patch)),
    [update],
  );

  const addFlashcard = useCallback(() => {
    const id = `f-new-${Date.now()}`;
    update((current) =>
      reconcileKit({
        ...current,
        flashcards: [
          ...current.flashcards,
          {
            id,
            front: "New prompt",
            back: "The answer you want to recall.",
            requirement_ids: current.role.requirements[0] ? [current.role.requirements[0].id] : [],
            state: "authored",
          },
        ],
      }),
    );
    return id;
  }, [update]);

  const deleteFlashcard = useCallback(
    (id: string) =>
      update((current) => reconcileKit({ ...current, flashcards: current.flashcards.filter((c) => c.id !== id) })),
    [update],
  );

  /**
   * Records a confidence rating. Ratings are practice data, not edits, so they
   * do not mark the card as `edited` and never block a regeneration.
   */
  const rateFlashcard = useCallback(
    (id: string, confidence: number) =>
      update((current) => ({
        ...current,
        flashcards: current.flashcards.map((card) =>
          card.id === id
            ? {
                ...card,
                confidence,
                last_reviewed_at: new Date().toISOString(),
                reviews: (card.reviews ?? 0) + 1,
              }
            : card,
        ),
      })),
    [update],
  );

  // --- brief, role, schedule ------------------------------------------------

  const editBrief = useCallback(
    (patch: Partial<Kit["company_brief"]>) =>
      update((current) => ({ ...current, company_brief: { ...current.company_brief, ...patch, state: "edited" } })),
    [update],
  );

  const editRole = useCallback(
    (patch: Partial<Kit["role"]>) =>
      update((current) => reconcileKit({ ...current, role: { ...current.role, ...patch, state: "edited" } })),
    [update],
  );

  const setSectionState = useCallback(
    (section: "company_brief" | "schedule", state: ItemState) =>
      update((current) => ({ ...current, [section]: { ...current[section], state } }) as Kit),
    [update],
  );

  // --- regeneration ---------------------------------------------------------

  const regenerate = useCallback(
    async (section: RegenerableSection, days?: number) => {
      if (!kitId) return;
      setRegenerating(section);
      setError(null);
      try {
        // Make sure the user's in-flight edits reach the server before the
        // merge runs, otherwise regeneration would merge against stale data.
        await flush();

        const response = await fetch(`/api/kits/${kitId}/regenerate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section, days }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message ?? "Could not regenerate that section.");
        setKit(payload.kit as Kit);
        setStatus("saved");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not regenerate that section.");
      } finally {
        setRegenerating(null);
      }
    },
    [kitId, flush],
  );

  return {
    kit,
    setKit,
    status,
    error,
    clearError: () => setError(null),
    regenerating,
    flush,
    editQuestion,
    addQuestion,
    deleteQuestion,
    moveQuestion,
    setQuestionState,
    editFlashcard,
    addFlashcard,
    deleteFlashcard,
    rateFlashcard,
    editBrief,
    editRole,
    setSectionState,
    regenerate,
  };
}

export type KitEditor = ReturnType<typeof useKitEditor>;
