"use client";

import { useState } from "react";
import type { Kit } from "@/lib/kit/types";
import { PracticeMode } from "./PracticeMode";
import { FlashcardsPanel, OverviewPanel, QuestionsPanel, SchedulePanel } from "./panels";
import { useKitEditor } from "./useKitEditor";

const VIEWS = ["Overview", "Questions", "Flashcards", "Schedule"] as const;
type View = (typeof VIEWS)[number];

const SAVE_LABEL = {
  saved: "All changes saved",
  unsaved: "Unsaved changes",
  saving: "Saving...",
  error: "Could not save",
} as const;

/**
 * The open kit. Mounted under `key={kitId}` by the workspace, so each kit gets
 * a fresh editor rather than inheriting the previous kit's unsaved draft.
 */
export function KitView({
  kitId,
  initialKit,
  onBeforeLeave,
}: {
  kitId: string;
  initialKit: Kit;
  onBeforeLeave: (flush: () => Promise<void>) => void;
}) {
  const editor = useKitEditor(kitId, initialKit);
  const [view, setView] = useState<View>("Overview");
  const [practising, setPractising] = useState(false);

  onBeforeLeave(editor.flush);
  const kit = editor.kit!;

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">INTERVIEW KIT / {kit.source.company.toUpperCase()}</span>
          <h1>{kit.role.title}</h1>
        </div>
        <div className="top-actions">
          <span className={`save-state ${editor.status}`} aria-live="polite">
            <i /> {SAVE_LABEL[editor.status]}
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={() => setPractising(true)}
            disabled={!kit.flashcards.length}
          >
            Practice mode <span>&#8599;</span>
          </button>
        </div>
      </header>

      <div className="content-wrap">
        {editor.error && (
          <div className="banner error" role="alert">
            {editor.error}
            <button type="button" className="text-button" onClick={editor.clearError}>
              Dismiss
            </button>
          </div>
        )}

        <nav className="section-nav" aria-label="Kit sections">
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              className={view === item ? "selected" : ""}
              onClick={() => setView(item)}
              aria-current={view === item}
            >
              {item}
              {item === "Questions" && <em>{kit.questions.length}</em>}
              {item === "Flashcards" && <em>{kit.flashcards.length}</em>}
            </button>
          ))}
        </nav>

        {view === "Overview" && <OverviewPanel editor={editor} onPractice={() => setPractising(true)} />}
        {view === "Questions" && <QuestionsPanel editor={editor} />}
        {view === "Flashcards" && <FlashcardsPanel editor={editor} onPractice={() => setPractising(true)} />}
        {view === "Schedule" && <SchedulePanel editor={editor} />}
      </div>

      {practising && <PracticeMode editor={editor} onClose={() => setPractising(false)} />}
    </>
  );
}
