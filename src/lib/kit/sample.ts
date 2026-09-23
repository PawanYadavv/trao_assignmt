import { buildSchedule } from "./schedule";
import type { Kit, Requirement } from "./types";

/**
 * A fixture kit used by the tests and by the UI's component previews.
 * It is never shown to a signed-in user as if it were their own kit.
 */
export function createSampleKit(): Kit {
  const requirements: Requirement[] = [
    { id: "r1", text: "Build accessible interfaces with React and TypeScript", kind: "technical", priority: "must" },
    { id: "r2", text: "Collaborate with product and design partners", kind: "behavioural", priority: "must" },
    { id: "r3", text: "Experience with testing and CI workflows", kind: "technical", priority: "nice" },
  ];

  const questions: Kit["questions"] = [
    {
      id: "q1",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "How would you structure a reusable React component library?",
      answer_outline: "Discuss boundaries, typed props, accessibility, testing, and documentation.",
      difficulty: 3,
      state: "generated",
    },
    {
      id: "q2",
      requirement_ids: ["r2"],
      category: "behavioural",
      prompt: "Tell us about a time product and design disagreed with your implementation plan.",
      answer_outline: "Situation, the trade-off, how you communicated, the outcome, and what changed afterwards.",
      difficulty: 2,
      state: "generated",
    },
    {
      id: "q3",
      requirement_ids: ["r3"],
      category: "technical",
      prompt: "What makes a frontend test suite trustworthy?",
      answer_outline: "User-facing behaviour, isolation, fast CI feedback, and avoiding brittle implementation tests.",
      difficulty: 2,
      state: "generated",
    },
  ];

  return {
    source: {
      company: "Northstar Labs",
      company_url: "https://example.com",
      role: "Senior Frontend Engineer",
      location: "Remote",
      jd_chars: 1240,
      researched_at: new Date().toISOString(),
      pages_used: ["https://example.com"],
      generation: { llm_used: false, model: null, hiring_page_found: false, discussion_found: false },
    },
    company_brief: {
      summary: "A product team building tools for modern operations.",
      what_they_do: "Northstar Labs helps teams coordinate complex work with a browser-based platform.",
      how_they_hire: "No published hiring process was found.",
      sources: ["https://example.com"],
      state: "generated",
    },
    role: {
      title: "Senior Frontend Engineer",
      seniority: "Senior",
      responsibilities: ["Own frontend architecture", "Partner across disciplines"],
      requirements,
      state: "generated",
    },
    questions,
    flashcards: [
      {
        id: "f1",
        front: "What should a reusable UI component guarantee?",
        back: "A clear API, accessible behaviour, predictable states, tests, and documentation.",
        requirement_ids: ["r1"],
        state: "generated",
      },
    ],
    schedule: { ...buildSchedule(requirements, questions, 5), state: "generated" },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    warnings: [],
  };
}
