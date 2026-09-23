import { buildSchedule } from "./schedule";
import type { Kit } from "./types";

export function createSampleKit(): Kit {
  const requirements = [
    { id: "r1", text: "Build accessible interfaces with React and TypeScript", kind: "technical" as const, priority: "must" as const },
    { id: "r2", text: "Collaborate with product and design partners", kind: "behavioural" as const, priority: "must" as const },
    { id: "r3", text: "Experience with testing and CI workflows", kind: "technical" as const, priority: "nice" as const },
  ];
  const questions = [
    { id: "q1", requirement_ids: ["r1"], category: "technical" as const, prompt: "How would you structure a reusable React component library?", answer_outline: "Discuss boundaries, typed props, accessibility, testing, and documentation.", difficulty: 3 as const, state: "generated" as const },
    { id: "q2", requirement_ids: ["r2"], category: "behavioural" as const, prompt: "Tell us about a time product and design disagreed with your implementation plan.", answer_outline: "Use STAR: context, trade-off, communication, outcome, and what changed afterward.", difficulty: 2 as const, state: "generated" as const },
    { id: "q3", requirement_ids: ["r3"], category: "technical" as const, prompt: "What makes a frontend test suite trustworthy?", answer_outline: "Cover user-facing behavior, test isolation, CI feedback, and avoiding brittle implementation tests.", difficulty: 2 as const, state: "generated" as const },
  ];
  return {
    source: { company: "Northstar Labs", company_url: "https://example.com", role: "Senior Frontend Engineer", location: "Remote", jd_chars: 1240, researched_at: new Date().toISOString(), pages_used: ["https://example.com"] },
    company_brief: { summary: "A product team building tools for modern operations.", what_they_do: "Northstar Labs helps teams coordinate complex work with a browser-based platform.", sources: ["https://example.com"] },
    role: { title: "Senior Frontend Engineer", seniority: "Senior", responsibilities: ["Own frontend architecture", "Partner across disciplines"], requirements },
    questions,
    flashcards: [{ id: "f1", front: "What should a reusable UI component guarantee?", back: "A clear API, accessible behavior, predictable states, tests, and documentation.", requirement_ids: ["r1"], state: "generated" }],
    schedule: buildSchedule(requirements, questions, 5),
    coverage: { uncovered_requirement_ids: [], passes: 2 },
  };
}
