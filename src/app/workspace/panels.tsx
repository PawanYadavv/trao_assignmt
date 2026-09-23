"use client";

import { useMemo, useState } from "react";
import { InlineEdit } from "./InlineEdit";
import type { KitEditor } from "./useKitEditor";
import type { Kit, Question, QuestionCategory } from "@/lib/kit/types";

const CATEGORIES: QuestionCategory[] = ["technical", "behavioural", "system-design", "company-fit"];

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

const DIFFICULTY_LABEL: Record<number, string> = { 1: "Warm-up", 2: "Medium", 3: "Hard" };

function StateBadge({ state }: { state?: string }) {
  if (!state || state === "generated") return null;
  const label = state === "pinned" ? "pinned" : state === "authored" ? "yours" : "edited";
  return <span className={`state-badge state-${state}`}>{label}</span>;
}

// --- Overview ----------------------------------------------------------------

export function OverviewPanel({ editor, onPractice }: { editor: KitEditor; onPractice: () => void }) {
  const kit = editor.kit!;
  const covered = kit.role.requirements.filter((requirement) =>
    kit.questions.some((question) => question.requirement_ids.includes(requirement.id)),
  ).length;
  const musts = kit.role.requirements.filter((requirement) => requirement.priority === "must");
  const uncovered = kit.coverage.uncovered_requirement_ids.length;
  const briefPinned = kit.company_brief.state === "pinned";

  return (
    <div className="overview-grid">
      <article className="brief-panel featured-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">01 / COMPANY BRIEF</span>
            <h2>Know who you are meeting.</h2>
          </div>
          <div className="panel-actions">
            <StateBadge state={kit.company_brief.state} />
            <button
              type="button"
              className="ghost-button small"
              onClick={() => editor.setSectionState("company_brief", briefPinned ? "generated" : "pinned")}
              aria-pressed={briefPinned}
            >
              {briefPinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => editor.regenerate("company_brief")}
              disabled={editor.regenerating !== null || briefPinned}
            >
              {editor.regenerating === "company_brief" ? "Researching..." : "Regenerate"}
            </button>
          </div>
        </div>

        <InlineEdit
          multiline
          label="company summary"
          value={kit.company_brief.summary}
          onCommit={(summary) => editor.editBrief({ summary })}
          className="brief-text"
        />
        <InlineEdit
          multiline
          label="what they do"
          value={kit.company_brief.what_they_do}
          onCommit={(what_they_do) => editor.editBrief({ what_they_do })}
          className="brief-text"
        />
        {kit.company_brief.how_they_hire && (
          <div className="hiring-note">
            <span className="section-kicker">HOW THEY HIRE</span>
            <InlineEdit
              multiline
              label="how they hire"
              value={kit.company_brief.how_they_hire}
              onCommit={(how_they_hire) => editor.editBrief({ how_they_hire })}
              className="brief-text"
            />
          </div>
        )}

        <div className="source-line">
          {kit.company_brief.sources.length
            ? `Researched from ${kit.company_brief.sources.length} public page${kit.company_brief.sources.length === 1 ? "" : "s"}`
            : "No company pages could be retrieved"}
        </div>
      </article>

      <article className="brief-panel readiness-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">COVERAGE</span>
            <h2>What is covered.</h2>
          </div>
          <span className="readiness-score">{kit.role.requirements.length ? Math.round((covered / kit.role.requirements.length) * 100) : 0}</span>
        </div>
        <div className="readiness-bar">
          <div style={{ width: `${kit.role.requirements.length ? (covered / kit.role.requirements.length) * 100 : 0}%` }} />
        </div>
        <div className="readiness-list">
          <span>
            <i className="done">&#10003;</i>
            {covered} of {kit.role.requirements.length} requirements have a question
          </span>
          <span>
            <i className={uncovered ? "pending" : "done"}>{uncovered ? "!" : "✓"}</i>
            {uncovered ? `${uncovered} must-have still uncovered` : "Every must-have is covered"}
          </span>
          <span>
            <i className="done">&#10003;</i>
            {kit.coverage.passes} coverage pass{kit.coverage.passes === 1 ? "" : "es"} run
          </span>
          <span>
            <i className="done">&#10003;</i>
            {musts.length} must-have, {kit.role.requirements.length - musts.length} nice-to-have
          </span>
        </div>
        <button type="button" className="text-button" onClick={onPractice}>
          Start a practice session <span>&rarr;</span>
        </button>
      </article>

      <article className="brief-panel role-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">02 / ROLE BREAKDOWN</span>
            <h2>The shape of the role.</h2>
          </div>
          <StateBadge state={kit.role.state} />
        </div>
        <div className="tag-row">
          <span>{kit.role.seniority}</span>
          <span>{kit.source.location}</span>
          <span>{kit.role.title}</span>
        </div>

        {kit.role.responsibilities.length > 0 && (
          <ul className="responsibility-list">
            {kit.role.responsibilities.map((item, index) => (
              <li key={`${item}-${index}`}>
                <InlineEdit
                  label={`responsibility ${index + 1}`}
                  value={item}
                  onCommit={(value) =>
                    editor.editRole({
                      responsibilities: kit.role.responsibilities.map((entry, at) => (at === index ? value : entry)),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}

        <ul className="requirement-list">
          {kit.role.requirements.map((requirement) => (
            <li key={requirement.id}>
              <span className={`priority-chip ${requirement.priority}`}>{requirement.priority}</span>
              <InlineEdit
                label={`requirement ${requirement.id}`}
                value={requirement.text}
                onCommit={(text) =>
                  editor.editRole({
                    requirements: kit.role.requirements.map((entry) =>
                      entry.id === requirement.id ? { ...entry, text } : entry,
                    ),
                  })
                }
              />
              <span className="requirement-kind">{requirement.kind}</span>
            </li>
          ))}
        </ul>
        {!kit.role.requirements.length && (
          <p className="empty-note">
            No requirements could be read from this description. That is reported rather than invented.
          </p>
        )}
      </article>

      {kit.warnings && kit.warnings.length > 0 && (
        <article className="brief-panel warnings-panel">
          <span className="section-kicker">WHAT WE COULD NOT FIND</span>
          <h2>Honest gaps.</h2>
          <ul>
            {kit.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

// --- Questions ---------------------------------------------------------------

export function QuestionsPanel({ editor }: { editor: KitEditor }) {
  const kit = editor.kit!;
  const [filter, setFilter] = useState<QuestionCategory | "all">("all");

  const visible = useMemo(
    () => kit.questions.filter((question) => filter === "all" || question.category === filter),
    [kit.questions, filter],
  );

  const regenerableCategory = filter === "all" ? null : filter;

  return (
    <div className="questions-view">
      <div className="view-heading">
        <div>
          <span className="section-kicker">QUESTION BANK</span>
          <h2>Questions worth your time.</h2>
          <p>Every question maps back to a requirement. Edited and pinned questions survive a regeneration.</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          disabled={!regenerableCategory || editor.regenerating !== null}
          onClick={() => regenerableCategory && editor.regenerate(regenerableCategory)}
          title={regenerableCategory ? undefined : "Choose a category to regenerate it on its own"}
        >
          {editor.regenerating && editor.regenerating === regenerableCategory
            ? "Regenerating..."
            : `Regenerate ${regenerableCategory ? CATEGORY_LABEL[regenerableCategory].toLowerCase() : "a category"}`}
        </button>
      </div>

      <div className="filter-row" role="tablist" aria-label="Question categories">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={`filter ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All <em>{kit.questions.length}</em>
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={filter === category}
            className={`filter ${filter === category ? "active" : ""}`}
            onClick={() => setFilter(category)}
          >
            {CATEGORY_LABEL[category]} <em>{kit.questions.filter((q) => q.category === category).length}</em>
          </button>
        ))}
        <button
          type="button"
          className="add-button"
          onClick={() => editor.addQuestion(filter === "all" ? "technical" : filter)}
        >
          + Add question
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="empty-note">
          No questions in this category yet. Add one by hand, or regenerate the category.
        </p>
      ) : (
        <ul className="question-list">
          {visible.map((question) => (
            <QuestionRow
              key={question.id}
              question={question}
              kit={kit}
              editor={editor}
              index={kit.questions.indexOf(question)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionRow({
  question,
  kit,
  editor,
  index,
}: {
  question: Question;
  kit: Kit;
  editor: KitEditor;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const pinned = question.state === "pinned";

  return (
    <li className="question-row">
      <div className="drag-handle">
        <button
          type="button"
          className="reorder-button"
          aria-label={`Move question ${index + 1} up`}
          disabled={index === 0}
          onClick={() => editor.moveQuestion(question.id, index - 1)}
        >
          &uarr;
        </button>
        <button
          type="button"
          className="reorder-button"
          aria-label={`Move question ${index + 1} down`}
          disabled={index === kit.questions.length - 1}
          onClick={() => editor.moveQuestion(question.id, index + 1)}
        >
          &darr;
        </button>
      </div>

      <div className="question-number">{String(index + 1).padStart(2, "0")}</div>

      <div className="question-body">
        <InlineEdit
          label={`question ${index + 1}`}
          value={question.prompt}
          onCommit={(prompt) => editor.editQuestion(question.id, { prompt })}
          className="question-prompt"
        />

        <div className="question-meta">
          <label className="visually-hidden" htmlFor={`category-${question.id}`}>
            Category for question {index + 1}
          </label>
          <select
            id={`category-${question.id}`}
            className="category-select"
            value={question.category}
            onChange={(event) => editor.moveQuestion(question.id, index, event.target.value as QuestionCategory)}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>

          <span>{DIFFICULTY_LABEL[question.difficulty]}</span>
          <span className="requirement-refs">
            {question.requirement_ids.length ? `covers ${question.requirement_ids.join(", ")}` : "no requirement linked"}
          </span>
          {question.added_in_pass ? <span className="pass-badge">pass {question.added_in_pass}</span> : null}
          <StateBadge state={question.state} />
          <button type="button" className="text-button small" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide outline" : "Show outline"}
          </button>
        </div>

        {expanded && (
          <div className="answer-outline">
            <span className="section-kicker">ANSWER OUTLINE</span>
            <InlineEdit
              multiline
              label={`answer outline for question ${index + 1}`}
              value={question.answer_outline}
              onCommit={(answer_outline) => editor.editQuestion(question.id, { answer_outline })}
            />
          </div>
        )}
      </div>

      <div className="row-actions">
        <button
          type="button"
          className="icon-button"
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin question ${index + 1}` : `Pin question ${index + 1}`}
          title={pinned ? "Unpin" : "Pin so regeneration cannot replace it"}
          onClick={() => editor.setQuestionState(question.id, pinned ? "generated" : "pinned")}
        >
          {pinned ? "◉" : "○"}
        </button>
        <button
          type="button"
          className="delete-button"
          aria-label={`Delete question ${index + 1}`}
          onClick={() => editor.deleteQuestion(question.id)}
        >
          &times;
        </button>
      </div>
    </li>
  );
}

// --- Flashcards --------------------------------------------------------------

export function FlashcardsPanel({ editor, onPractice }: { editor: KitEditor; onPractice: () => void }) {
  const kit = editor.kit!;

  return (
    <div className="flashcards-view">
      <div className="view-heading">
        <div>
          <span className="section-kicker">FLASHCARDS</span>
          <h2>Recall, then reveal.</h2>
          <p>{kit.flashcards.length} cards. Confidence you record here orders your next practice session.</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="ghost-button" onClick={() => editor.addFlashcard()}>
            + Add card
          </button>
          <button type="button" className="primary-button" onClick={onPractice} disabled={!kit.flashcards.length}>
            Practice all <span>&#8599;</span>
          </button>
        </div>
      </div>

      {kit.flashcards.length === 0 ? (
        <p className="empty-note">No flashcards yet. Add one by hand to start a deck.</p>
      ) : (
        <ul className="flashcard-list">
          {kit.flashcards.map((card, index) => (
            <li className="flashcard-row" key={card.id}>
              <div className="flashcard-body">
                <InlineEdit
                  label={`flashcard ${index + 1} front`}
                  value={card.front}
                  onCommit={(front) => editor.editFlashcard(card.id, { front })}
                  className="flashcard-front"
                />
                <InlineEdit
                  multiline
                  label={`flashcard ${index + 1} back`}
                  value={card.back}
                  onCommit={(back) => editor.editFlashcard(card.id, { back })}
                  className="flashcard-back"
                />
                <div className="question-meta">
                  <span className="requirement-refs">
                    {card.requirement_ids.length ? `covers ${card.requirement_ids.join(", ")}` : "no requirement linked"}
                  </span>
                  <span>{card.confidence ? `confidence ${card.confidence}/3` : "not yet practised"}</span>
                  <StateBadge state={card.state} />
                </div>
              </div>
              <button
                type="button"
                className="delete-button"
                aria-label={`Delete flashcard ${index + 1}`}
                onClick={() => editor.deleteFlashcard(card.id)}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Schedule ----------------------------------------------------------------

export function SchedulePanel({ editor }: { editor: KitEditor }) {
  const kit = editor.kit!;
  const [days, setDays] = useState(String(kit.schedule.days_available));
  const pinned = kit.schedule.state === "pinned";
  const totalMinutes = kit.schedule.days.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <div className="schedule-view">
      <div className="view-heading">
        <div>
          <span className="section-kicker">YOUR PLAN</span>
          <h2>
            {kit.schedule.days_available} day{kit.schedule.days_available === 1 ? "" : "s"}, {totalMinutes} minutes.
          </h2>
          <p>Harder, higher-priority material lands first. The last day is consolidation.</p>
        </div>
        <div className="panel-actions">
          <label className="days-field">
            Days
            <input
              type="number"
              min={1}
              max={60}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              aria-label="Days until the interview"
            />
          </label>
          <button
            type="button"
            className="ghost-button small"
            aria-pressed={pinned}
            onClick={() => editor.setSectionState("schedule", pinned ? "generated" : "pinned")}
          >
            {pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={editor.regenerating !== null || pinned}
            onClick={() => editor.regenerate("schedule", Number(days))}
          >
            {editor.regenerating === "schedule" ? "Rebuilding..." : "Rebuild plan"}
          </button>
        </div>
      </div>

      <ol className="day-list">
        {kit.schedule.days.map((day) => (
          <li className={`day-row ${day.day === 1 ? "today" : ""}`} key={day.day}>
            <div className="day-label">
              <span>DAY</span>
              <strong>{String(day.day).padStart(2, "0")}</strong>
            </div>
            <div className="day-focus">
              <h3>{day.focus}</h3>
              <p>
                {day.question_ids.length} question{day.question_ids.length === 1 ? "" : "s"} &middot; {day.minutes} minutes
              </p>
              <ul className="day-questions">
                {day.question_ids.map((id) => {
                  const question = kit.questions.find((entry) => entry.id === id);
                  return question ? <li key={id}>{question.prompt}</li> : null;
                })}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
