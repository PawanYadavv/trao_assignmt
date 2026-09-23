"use client";

import { useEffect, useMemo, useState } from "react";
import type { Flashcard } from "@/lib/kit/types";
import type { KitEditor } from "./useKitEditor";

/**
 * Orders a practice session weakest-first.
 *
 * A confidence-weighted sort rather than a full spaced-repetition schedule:
 * cards you have never seen come first (an unknown is riskier than a known
 * weakness), then the lowest confidence, and ties break on the oldest review so
 * a card cannot monopolise the session. With an interview days away, the
 * scarce resource is attention, not long-term retention - which is what SM-2
 * style intervals optimise for.
 */
export function orderForPractice(cards: Flashcard[]): Flashcard[] {
  return [...cards].sort((left, right) => {
    const leftSeen = left.reviews ?? 0;
    const rightSeen = right.reviews ?? 0;
    if ((leftSeen === 0) !== (rightSeen === 0)) return leftSeen === 0 ? -1 : 1;

    const leftConfidence = left.confidence ?? 0;
    const rightConfidence = right.confidence ?? 0;
    if (leftConfidence !== rightConfidence) return leftConfidence - rightConfidence;

    const leftAt = left.last_reviewed_at ? Date.parse(left.last_reviewed_at) : 0;
    const rightAt = right.last_reviewed_at ? Date.parse(right.last_reviewed_at) : 0;
    return leftAt - rightAt;
  });
}

export function PracticeMode({ editor, onClose }: { editor: KitEditor; onClose: () => void }) {
  const kit = editor.kit!;
  // The order is fixed when the session opens, so rating a card does not
  // reshuffle the deck under the user mid-session.
  const deck = useMemo(() => orderForPractice(kit.flashcards), [kit.flashcards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [ratedThisSession, setRatedThisSession] = useState<Record<string, number>>({});

  const card = deck[index];
  const finished = index >= deck.length;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (finished) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
      }
      if (revealed && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        rate(Number(event.key));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function rate(confidence: number) {
    if (!card) return;
    editor.rateFlashcard(card.id, confidence);
    setRatedThisSession((current) => ({ ...current, [card.id]: confidence }));
    setRevealed(false);
    setIndex((current) => current + 1);
  }

  const sessionCount = Object.keys(ratedThisSession).length;
  const practised = kit.flashcards.filter((entry) => (entry.reviews ?? 0) > 0).length;
  const shaky = kit.flashcards.filter((entry) => (entry.confidence ?? 0) === 1).length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Practice flashcards">
      <div className="practice-modal">
        <button type="button" className="close-button" onClick={onClose} aria-label="Close practice mode">
          &times;
        </button>

        {finished ? (
          <div className="practice-summary">
            <span className="section-kicker">SESSION COMPLETE</span>
            <h2>{sessionCount} card{sessionCount === 1 ? "" : "s"} reviewed.</h2>
            <ul className="readiness-list">
              <li>
                {practised} of {kit.flashcards.length} cards practised at least once
              </li>
              <li>{shaky} card{shaky === 1 ? "" : "s"} still rated shaky - those come first next time</li>
            </ul>
            <div className="practice-actions">
              <button
                type="button"
                className="primary-button wide"
                onClick={() => {
                  setIndex(0);
                  setRevealed(false);
                }}
              >
                Go again, weakest first
              </button>
              <button type="button" className="ghost-button wide" onClick={onClose}>
                Done for now
              </button>
            </div>
          </div>
        ) : (
          <>
            <span className="section-kicker">
              PRACTICE MODE &middot; {String(index + 1).padStart(2, "0")} / {String(deck.length).padStart(2, "0")}
            </span>
            <div className="practice-progress" role="progressbar" aria-valuenow={index} aria-valuemin={0} aria-valuemax={deck.length}>
              <span style={{ width: `${(index / deck.length) * 100}%` }} />
            </div>

            <h2>{card.front}</h2>

            {card.confidence ? (
              <p className="practice-last">Last time you rated this {card.confidence}/3.</p>
            ) : (
              <p className="practice-last">You have not practised this card yet.</p>
            )}

            {revealed ? (
              <div className="answer-box">
                <span>Answer</span>
                <p>{card.back}</p>
              </div>
            ) : (
              <p className="practice-hint">Say your answer out loud, then reveal. (Space to reveal)</p>
            )}

            <div className="practice-actions">
              {!revealed ? (
                <button type="button" className="primary-button wide" onClick={() => setRevealed(true)}>
                  Reveal answer
                </button>
              ) : (
                <div className="confidence-picker">
                  <span>How confident did you feel?</span>
                  <div>
                    {[1, 2, 3].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="confidence"
                        onClick={() => rate(value)}
                        aria-label={`Confidence ${value} of 3`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
