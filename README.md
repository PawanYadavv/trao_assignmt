# Prepwise

Prepwise turns a job description and company URL into a focused interview preparation kit. This repository is intentionally built as a teaching project: deterministic rules are ordinary TypeScript functions that can be tested without an LLM.

## Stack

Next.js App Router and TypeScript provide one deployable frontend/backend application. Node `fetch` handles bounded company research. Tailwind is included by the starter, with a small CSS design layer for the product UI. The first UI slice uses local sample state so it works without credentials.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## MongoDB setup

Copy `.env.example` to `.env.local` and set `MONGODB_URI` to a MongoDB Atlas connection string. `MONGODB_DB_NAME` defaults to `prepwise`. Users, seven-day sessions, and kits are stored in the `users`, `sessions`, and `kits` collections, so restarting the server no longer deletes them.

Do not commit `.env.local` or put the connection string in frontend code.

## Batch evaluation

```bash
npm run evaluate -- --input cases.json --output kits.json
```

The command reads Appendix B input, uses the same retrieval and generation functions as the API route, continues after individual failures, and writes one output record per case.

## Architecture

`retrieve.ts` validates URLs, fetches the homepage with retries, ranks same-origin links using hiring-related words, fetches a bounded set, and cleans HTML into text. Failed sources are warnings rather than whole-run failures.

`generate.ts` extracts requirements, creates questions, runs deterministic coverage, adds a second-pass question for any gap, and allocates questions across exactly the requested days. `schedule.ts`, `coverage.ts`, and `validate.ts` contain no network or UI code.

The API endpoint is `POST /api/kits` with `{ jd, company_url, days }`. It returns `{ kit, warnings }` or a structured error.

The dashboard also accepts a JSON batch upload containing an array of `{ jd, company_url, days }` cases and processes them through the same API pipeline. The CLI preserves one output record for every input case, including malformed cases as `status: "failed"`.

## Editing model

Generated content has `state: "generated"`; user changes become `state: "edited"`. A production persistence layer should merge regenerated records only when `state !== "edited"`, preserving user content outside the regenerated section. The dashboard demonstrates this non-destructive interaction and local inline editing.

## Tests

```bash
npm test
npm run lint
npm run build
```

Tests protect must-have coverage, exact schedule length with integer minutes, stable question references, and structure validation.

## Deliberate next production steps

The generator is deterministic so it works without an LLM credential and stays honest for thin descriptions. When configured, the optional OpenAI-compatible adapter extracts requirements. Public Hacker News discussions are included as research sources when available. User edits, question ordering, additions, deletions, and confidence ratings replace the latest saved kit, and technical regeneration skips edited questions. New passwords use salted scrypt; older local SHA-256 records remain readable for migration.
