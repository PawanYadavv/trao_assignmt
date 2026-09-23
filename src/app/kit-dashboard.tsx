"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSampleKit } from "@/lib/kit/sample";
import type { Kit, Question } from "@/lib/kit/types";

const initialKit = createSampleKit();
const navItems = ["Overview", "Questions", "Flashcards", "Schedule"] as const;
type View = (typeof navItems)[number];

export default function KitDashboard() {
  const router = useRouter();
  const [kit, setKit] = useState<Kit>(initialKit);
  const [view, setView] = useState<View>("Overview");
  const [isPractice, setIsPractice] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState("Draft saved locally");
  const [showCreateKit, setShowCreateKit] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/kits")
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/login");
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((payload) => {
        const kits = payload?.kits as Kit[] | undefined;
        if (active && kits?.length) setKit(kits[kits.length - 1]);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [router]);

  const coveredCount = kit.role.requirements.filter((requirement) =>
    kit.questions.some((question) => question.requirement_ids.includes(requirement.id)),
  ).length;
  const practiceCard = kit.flashcards[0];
  const completion = Math.round((coveredCount / kit.role.requirements.length) * 100);

  function persistKit(nextKit: Kit) {
    void fetch("/api/kits/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kit: nextKit }) });
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setKit((current) => {
      const nextKit: Kit = {
      ...current,
      questions: current.questions.map((question) => question.id === id ? { ...question, ...patch, state: "edited" as const } : question),
      };
      persistKit(nextKit);
      return nextKit;
    });
    setNotice("Question edit saved");
  }

  function regenerateCategory() {
    setKit((current) => {
      const nextKit: Kit = { ...current, questions: current.questions.map((question) => question.category === "technical" && question.state !== "edited" ? { ...question, prompt: `How would you demonstrate strength in requirement ${question.requirement_ids.join(", ")}?`, state: "generated" as const } : question) };
      persistKit(nextKit);
      return nextKit;
    });
    setNotice("Technical questions regenerated; edited content was preserved");
  }

  function addQuestion() {
    const nextQuestion: Question = { id: `q${Date.now()}`, requirement_ids: [kit.role.requirements[0]?.id ?? ""].filter(Boolean), category: "technical", prompt: "Add your interview question here.", answer_outline: "Add an answer outline here.", difficulty: 2, state: "edited" };
    const nextKit = { ...kit, questions: [...kit.questions, nextQuestion] };
    setKit(nextKit);
    persistKit(nextKit);
    setEditingQuestion(nextQuestion.id);
    setNotice("Question added");
  }

  function deleteQuestion(id: string) {
    const nextKit = { ...kit, questions: kit.questions.filter((question) => question.id !== id) };
    setKit(nextKit);
    persistKit(nextKit);
    setNotice("Question deleted");
  }

  function moveQuestion(id: string, direction: -1 | 1) {
    const index = kit.questions.findIndex((question) => question.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= kit.questions.length) return;
    const questions = [...kit.questions];
    [questions[index], questions[target]] = [questions[target], questions[index]];
    const nextKit = { ...kit, questions };
    setKit(nextKit);
    persistKit(nextKit);
    setNotice("Question order saved");
  }

  function rateCard(value: number) {
    setConfidence((current) => ({ ...current, [practiceCard.id]: value }));
    persistKit({ ...kit, flashcards: kit.flashcards.map((card) => card.id === practiceCard.id ? { ...card, confidence: value } : card) } as Kit);
    setNotice("Confidence recorded");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function createKit(input: { jd: string; company_url: string; days: number }) {
    setIsGenerating(true);
    setGenerationError("");
    try {
      const response = await fetch("/api/kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not generate the kit.");
      setKit(payload.kit as Kit);
      const saveResponse = await fetch("/api/kits/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kit: payload.kit }),
      });
      if (!saveResponse.ok) throw new Error("Your session expired. Please log in again.");
      setView("Overview");
      setShowCreateKit(false);
      setNotice("New kit generated and saved");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Could not generate the kit.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function createBatch(cases: { jd: string; company_url: string; days: number }[]) {
    setIsGenerating(true);
    setGenerationError("");
    try {
      let latest: Kit | null = null;
      for (const input of cases) {
        const response = await fetch("/api/kits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "One batch case failed.");
        latest = payload.kit as Kit;
        const saveResponse = await fetch("/api/kits/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kit: latest }) });
        if (!saveResponse.ok) throw new Error("Your session expired. Please log in again.");
      }
      if (latest) setKit(latest);
      setShowCreateKit(false);
      setNotice(`${cases.length} kits generated and saved`);
    } catch (error) { setGenerationError(error instanceof Error ? error.message : "Batch generation failed."); }
    finally { setIsGenerating(false); }
  }

  return (
    <main className="workspace-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span>◎</span> prepwise</div>
        <div className="sidebar-label">YOUR KITS</div>
        <button className="kit-link active"><span className="status-dot" /> Northstar Labs <small>draft</small></button>
        <button className="kit-link" onClick={() => setShowCreateKit(true)}><span className="status-dot muted" /> Add a new kit <b>+</b></button>
        <div className="sidebar-bottom">
          <div className="profile"><div className="avatar">AK</div><div><strong>Alex Kim</strong><span>Free workspace</span></div><button className="logout-button" onClick={logout}>Log out</button></div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div><span className="eyebrow">INTERVIEW KIT / NORTHSTAR LABS</span><h1>Senior Frontend Engineer</h1></div>
          <div className="top-actions"><span className="save-state"><i /> {notice}</span><button className="ghost-button" onClick={() => setNotice("Share link copied")}>Share kit</button><button className="primary-button" onClick={() => setIsPractice(true)}>Practice mode <span>↗</span></button></div>
        </header>

        <div className="content-wrap">
          <div className="progress-strip"><div><strong>{completion}% ready</strong><span> · 4 of 5 preparation areas complete</span></div><div className="progress-track"><div style={{ width: `${completion}%` }} /></div><span className="days-left">5 days left</span></div>
          <nav className="section-nav" aria-label="Kit sections">{navItems.map((item) => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item}{item === "Questions" && <em>{kit.questions.length}</em>}</button>)}</nav>

          {view === "Overview" && <Overview kit={kit} onPractice={() => setIsPractice(true)} />}
          {view === "Questions" && <Questions questions={kit.questions} editingQuestion={editingQuestion} setEditingQuestion={setEditingQuestion} updateQuestion={updateQuestion} regenerateCategory={regenerateCategory} addQuestion={addQuestion} deleteQuestion={deleteQuestion} moveQuestion={moveQuestion} />}
          {view === "Flashcards" && <Flashcards card={practiceCard} confidence={confidence[practiceCard.id]} onPractice={() => setIsPractice(true)} />}
          {view === "Schedule" && <Schedule kit={kit} />}
        </div>
      </section>

      {isPractice && <PracticeModal card={practiceCard} revealed={revealed} setRevealed={setRevealed} confidence={confidence[practiceCard.id]} rateCard={rateCard} close={() => { setIsPractice(false); setRevealed(false); }} />}
      {showCreateKit && <CreateKitModal isGenerating={isGenerating} error={generationError} close={() => { if (!isGenerating) setShowCreateKit(false); }} submit={createKit} submitBatch={createBatch} />}
    </main>
  );
}

function CreateKitModal({ isGenerating, error, close, submit, submitBatch }: { isGenerating: boolean; error: string; close: () => void; submit: (input: { jd: string; company_url: string; days: number }) => Promise<void>; submitBatch: (inputs: { jd: string; company_url: string; days: number }[]) => Promise<void> }) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState("5");
  const [batchCases, setBatchCases] = useState<{ jd: string; company_url: string; days: number }[]>([]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void (batchCases.length ? submitBatch(batchCases) : submit({ jd, company_url: companyUrl, days: Number(days) }));
  }

  function readBatch(file: File) { void file.text().then((text) => { const parsed = JSON.parse(text) as { jd: string; company_url: string; days: number }[]; setBatchCases(parsed); }); }

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create an interview kit"><form className="create-kit-modal" onSubmit={onSubmit}><button className="close-button" type="button" onClick={close} aria-label="Close create kit">×</button><span className="section-kicker">NEW INTERVIEW KIT</span><h2>Turn a job description into a plan.</h2><p className="modal-description">We will research the company, find the key requirements, and build your practice kit.</p><label>Upload batch JSON<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && readBatch(event.target.files[0])} /></label>{batchCases.length > 0 && <p className="batch-note">{batchCases.length} cases ready to generate.</p>}<label>Job description<textarea required={!batchCases.length} minLength={10} value={jd} onChange={(event) => setJd(event.target.value)} placeholder="Paste the full job description here..." /></label><label>Company website<input required={!batchCases.length} type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} placeholder="https://company.com" /></label><label>Days until interview<input required={!batchCases.length} type="number" min="1" max="60" value={days} onChange={(event) => setDays(event.target.value)} /></label>{error && <p className="error-text">{error}</p>}<button className="primary-button generate-button" disabled={isGenerating} type="submit">{isGenerating ? "Researching and generating..." : batchCases.length ? "Generate batch" : "Generate my kit"}<span>{isGenerating ? "..." : "→"}</span></button></form></div>;
}

function Overview({ kit, onPractice }: { kit: Kit; onPractice: () => void }) {
  return <div className="overview-grid">
    <article className="brief-panel featured-panel"><div className="panel-heading"><div><span className="section-kicker">01 / COMPANY BRIEF</span><h2>Know who you are meeting.</h2></div><button className="icon-button" aria-label="Edit company brief">✎</button></div><p>{kit.company_brief.summary}</p><p>{kit.company_brief.what_they_do}</p><div className="source-line">◎ Researched from {kit.company_brief.sources.length} public page{kit.company_brief.sources.length === 1 ? "" : "s"} <span>↗</span></div></article>
    <article className="brief-panel readiness-panel"><div className="panel-heading"><div><span className="section-kicker">YOUR READINESS</span><h2>Keep the momentum.</h2></div><span className="readiness-score">72</span></div><div className="readiness-bar"><div /></div><div className="readiness-list"><span><i className="done">✓</i>Company context <b>done</b></span><span><i className="done">✓</i>Role requirements <b>done</b></span><span><i className="pending">○</i>Practice flashcards <b>next</b></span></div><button className="text-button" onClick={onPractice}>Start a practice session <span>→</span></button></article>
    <article className="brief-panel role-panel"><div className="panel-heading"><div><span className="section-kicker">02 / ROLE BREAKDOWN</span><h2>The shape of the role.</h2></div><button className="icon-button" aria-label="Edit role breakdown">✎</button></div><div className="tag-row"><span>Senior</span><span>Remote</span><span>Frontend</span></div><ul>{kit.role.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul><div className="requirement-callout"><strong>{kit.role.requirements.length} requirements</strong><span>mapped to {kit.questions.length} practice questions</span></div></article>
    <article className="brief-panel next-panel"><span className="section-kicker">UP NEXT</span><h2>Day 1 · Core requirements</h2><p>Build a strong story around the skills your interviewer will care about most.</p><div className="next-meta"><span>3 questions</span><span>45 min</span></div><button className="primary-button wide" onClick={onPractice}>Begin day 1 <span>→</span></button></article>
  </div>;
}

function Questions({ questions, editingQuestion, setEditingQuestion, updateQuestion, regenerateCategory, addQuestion, deleteQuestion, moveQuestion }: { questions: Question[]; editingQuestion: string | null; setEditingQuestion: (id: string | null) => void; updateQuestion: (id: string, patch: Partial<Question>) => void; regenerateCategory: () => void; addQuestion: () => void; deleteQuestion: (id: string) => void; moveQuestion: (id: string, direction: -1 | 1) => void }) {
  return <div className="questions-view"><div className="view-heading"><div><span className="section-kicker">QUESTION BANK</span><h2>Questions worth your time.</h2><p>Every question maps back to a requirement from the job description.</p></div><button className="ghost-button" onClick={regenerateCategory}>↻ Regenerate technical</button></div><div className="filter-row"><button className="filter active">All <em>{questions.length}</em></button><button className="filter">Technical <em>{questions.filter((question) => question.category === "technical").length}</em></button><button className="filter">Behavioural <em>{questions.filter((question) => question.category === "behavioural").length}</em></button><button className="add-button" onClick={addQuestion}>+ Add question</button></div><div className="question-list">{questions.map((question, index) => <article className="question-row" key={question.id}><div className="drag-handle" aria-label="Reorder question"><button className="reorder-button" onClick={() => moveQuestion(question.id, -1)} aria-label="Move question up">↑</button><button className="reorder-button" onClick={() => moveQuestion(question.id, 1)} aria-label="Move question down">↓</button></div><div className="question-number">{String(index + 1).padStart(2, "0")}</div><div className="question-body">{editingQuestion === question.id ? <input autoFocus className="edit-input" value={question.prompt} onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })} onBlur={() => setEditingQuestion(null)} /> : <button className="question-prompt" onClick={() => setEditingQuestion(question.id)}>{question.prompt}</button>}<div className="question-meta"><span className={`category ${question.category}`}>{question.category}</span><span>{question.difficulty === 3 ? "Hard" : "Medium"}</span><span>↳ {question.requirement_ids.join(", ")}</span>{question.state === "edited" && <span className="edited-label">edited</span>}</div></div><button className="icon-button" onClick={() => setEditingQuestion(question.id)} aria-label="Edit question">✎</button><button className="delete-button" onClick={() => deleteQuestion(question.id)} aria-label="Delete question">×</button></article>)}</div></div>;
}

function Flashcards({ card, confidence, onPractice }: { card: Kit["flashcards"][number]; confidence?: number; onPractice: () => void }) {
  return <div className="flashcards-view"><div className="view-heading"><div><span className="section-kicker">FLASHCARDS</span><h2>Recall, then reveal.</h2><p>Small repetitions turn fuzzy knowledge into interview confidence.</p></div><button className="primary-button" onClick={onPractice}>Practice all <span>↗</span></button></div><div className="flashcard-preview"><span className="card-count">01 / 06</span><h3>{card.front}</h3><div className="card-divider" /><p>{confidence ? `Last confidence: ${confidence} / 3` : "Answer in your own words before revealing."}</p><button className="text-button" onClick={onPractice}>Reveal answer <span>→</span></button></div></div>;
}

function Schedule({ kit }: { kit: Kit }) {
  return <div className="schedule-view"><div className="view-heading"><div><span className="section-kicker">YOUR PLAN</span><h2>Five calm days.</h2><p>Harder, higher-priority material arrives early. The final day is for confidence.</p></div><button className="ghost-button">↗ Export plan</button></div><div className="day-list">{kit.schedule.days.map((day) => <article className={`day-row ${day.day === 1 ? "today" : ""}`} key={day.day}><div className="day-label"><span>DAY</span><strong>0{day.day}</strong></div><div className="day-focus"><h3>{day.focus}</h3><p>{day.question_ids.length} questions · {day.minutes} minutes</p></div><div className="day-progress"><div><span style={{ width: `${day.day === 1 ? 82 : day.day === 5 ? 0 : 18}%` }} /></div><small>{day.day === 1 ? "In progress" : "Not started"}</small></div><span className="arrow">→</span></article>)}</div></div>;
}

function PracticeModal({ card, revealed, setRevealed, confidence, rateCard, close }: { card: Kit["flashcards"][number]; revealed: boolean; setRevealed: (value: boolean) => void; confidence?: number; rateCard: (value: number) => void; close: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Practice flashcard"><div className="practice-modal"><button className="close-button" onClick={close} aria-label="Close practice mode">×</button><span className="section-kicker">PRACTICE MODE · 01 / 06</span><div className="practice-progress"><span /></div><h2>{card.front}</h2>{revealed ? <div className="answer-box"><span>Answer outline</span><p>{card.back}</p></div> : <p className="practice-hint">Take a breath. Say your answer out loud, then reveal the outline.</p>}<div className="practice-actions">{!revealed ? <button className="primary-button wide" onClick={() => setRevealed(true)}>Reveal answer</button> : <div className="confidence-picker"><span>How confident did you feel?</span><div>{[1, 2, 3].map((value) => <button key={value} className={confidence === value ? "confidence selected" : "confidence"} onClick={() => rateCard(value)}>{value}</button>)}</div></div>}</div></div></div>;
}
