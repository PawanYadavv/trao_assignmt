export type RequirementKind = "technical" | "behavioural" | "domain";
export type RequirementPriority = "must" | "nice";
export type QuestionCategory = "technical" | "behavioural" | "system-design" | "company-fit";

/**
 * Provenance for every editable item.
 *
 * `generated`  produced by the pipeline and safe to replace on regeneration
 * `edited`     changed by the user; regeneration must leave it alone
 * `pinned`     explicitly kept by the user; regeneration must leave it alone
 *
 * `authored` marks items the user created by hand. They behave like `edited`
 * but are reported separately so the UI can explain why they survived.
 */
export type ItemState = "generated" | "edited" | "pinned" | "authored";

export const PROTECTED_STATES: ReadonlySet<ItemState> = new Set<ItemState>(["edited", "pinned", "authored"]);

export function isProtected(state: ItemState | undefined) {
  return PROTECTED_STATES.has(state ?? "generated");
}

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  /** Verbatim line the requirement was taken from, for auditability. */
  source_line?: string;
}

export interface Question {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
  state?: ItemState;
  /** Set when the question was added by a coverage pass rather than the first draft. */
  added_in_pass?: number;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  state?: ItemState;
  /** Last self-rated confidence, 1 (shaky) to 3 (solid). */
  confidence?: number;
  /** ISO timestamp of the last practice review. */
  last_reviewed_at?: string;
  reviews?: number;
}

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface Kit {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
    /** Extension: how the kit was produced, so degraded runs are visible. */
    generation?: {
      llm_used: boolean;
      model: string | null;
      hiring_page_found: boolean;
      discussion_found: boolean;
    };
  };
  company_brief: {
    summary: string;
    what_they_do: string;
    sources: string[];
    /** Extension: how the company hires, when a hiring page was found. */
    how_they_hire?: string;
    state?: ItemState;
  };
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Requirement[];
    state?: ItemState;
  };
  questions: Question[];
  flashcards: Flashcard[];
  schedule: {
    days_available: number;
    days: ScheduleDay[];
    state?: ItemState;
  };
  coverage: {
    uncovered_requirement_ids: string[];
    passes: number;
  };
  /** Extension: honest, user-facing notes about what could not be researched. */
  warnings?: string[];
}

/** A kit as persisted for a user. */
export interface KitRecord {
  id: string;
  userId: string;
  title: string;
  kit: Kit;
  createdAt: string;
  updatedAt: string;
  /** Hash of jd + company_url + days, used to detect duplicate submissions. */
  fingerprint: string;
}
