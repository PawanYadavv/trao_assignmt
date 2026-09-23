# Prepwise

Turns a pasted job description and a company URL into a structured interview
preparation kit: a company brief, a role breakdown, a categorised question bank,
flashcards and a day-by-day schedule. The kit is a draft you can reshape — edit,
reorder, add, delete, and regenerate one section without losing work elsewhere —
and practise against inside the app.

---

## Contents

- [Stack](#stack)
- [Setup](#setup)
- [Batch entry point](#batch-entry-point)
- [Architecture](#architecture)
- [Retrieval](#retrieval)
- [Research and generation sequence](#research-and-generation-sequence)
- [The second pass](#the-second-pass)
- [Generated, edited and pinned state](#generated-edited-and-pinned-state)
- [Schedule allocation](#schedule-allocation)
- [Practice mode](#practice-mode)
- [Edge cases and failure handling](#edge-cases-and-failure-handling)
- [Security](#security)
- [Tests](#tests)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Known limitations](#known-limitations)

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js (App Router) + React 19 | Preferred stack. |
| Backend | Next.js Route Handlers on Node | **Differs from the brief's Express suggestion.** One deployable, one module graph, one type system across the HTTP boundary, and the batch command imports the same pipeline functions the API calls. A separate Express process would have duplicated deployment and shared-code plumbing for no benefit at this size. |
| Database | MongoDB (Atlas free tier) | Preferred stack. Kits are documents with nested arrays; storing one as a document avoids an ORM and a dozen join tables. |
| Language | TypeScript | Preferred stack. |
| Styling | Hand-written CSS, Tailwind available | **Differs from the brief's Tailwind default.** The design leans on a small token set and a handful of component classes; long utility strings made the JSX harder to read for this kind of dense editor UI. Tailwind is installed and can be used alongside it. |
| Scraping | `fetch` + regex extraction, no headless browser | A browser engine does not fit a free tier's memory budget and is not needed: company about/careers pages are server-rendered. See [Known limitations](#known-limitations). |
| LLM | Any OpenAI-compatible provider; **Groq `llama-3.3-70b-versatile`** by default | Genuine free tier, no card, fast, and OpenAI-compatible so the provider is one environment variable. |
| Tests | `node:test` via `tsx` | No test-framework dependency for what is mostly pure-function testing. |

### It runs without an API key

Every model call has a deterministic counterpart, and the pipeline falls back
per step rather than all at once. With no `LLM_API_KEY` set, the full pipeline
still runs end to end and produces a valid kit — the wording is templated rather
than written. Each kit records which path it took:

```json
"generation": { "llm_used": false, "model": null, "hiring_page_found": true, "discussion_found": false }
```

This is a deliberate robustness property, not a fallback nobody tested: it is
the path the test suite and the committed `cases.json` run on.

---

## Setup

### Local

```bash
git clone <repo>
cd trao_assignment
npm install
cp .env.example .env.local     # then fill in MONGODB_URI and, optionally, LLM_API_KEY
npm run dev                    # http://localhost:3000
```

Register an account, then create a kit.

### Environment variables

Every variable is documented in [`.env.example`](.env.example).

| Variable | Required for | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | web app | Atlas connection string. Users, sessions and kits. **Not needed for `npm run evaluate`.** |
| `MONGODB_DB_NAME` | web app | Database name. Defaults to `prepwise`. |
| `LLM_API_URL` | optional | OpenAI-compatible `/chat/completions` endpoint. |
| `LLM_API_KEY` | optional | Provider key. Without it, the deterministic path runs. |
| `LLM_MODEL` | optional | Defaults to `llama-3.3-70b-versatile`. |
| `LLM_MAX_CONCURRENCY` | optional | In-flight model calls. Default 2. |
| `LLM_REQUESTS_PER_MINUTE` | optional | Client-side rate window. Default 25. |
| `LLM_MAX_RETRIES` | optional | Retries per call. Default 4. |
| `ALLOW_PRIVATE_CRAWL_TARGETS` | optional | Permits crawling private/loopback addresses. Defaults to **on** outside production (the batch harness may serve sites from localhost) and **off** in production. |

### Deployed

Deployed on Vercel with MongoDB Atlas. Frontend and API are the same
deployment; the API is reachable at `/api/*`. Secrets live in Vercel's
environment variables, never in the repo — `.env.local` is gitignored and
`.env.example` contains only placeholders.

Atlas needs the deployment's egress allowed under Network Access, and the
database user needs read/write on the `prepwise` database.

---

## Batch entry point

```bash
npm install
npm run evaluate -- --input cases.json --output kits.json
```

Runs from a clean clone with no `.env` file: the batch path never touches the
database, and the LLM is optional.

- Reads the Appendix B input array and writes the Appendix B output shape.
- Calls `runPipeline` — the **same function** `POST /api/kits` calls. There is no
  second implementation; `scripts/evaluate.ts` only does file I/O, concurrency
  and error shaping.
- Uses each case's own `days`.
- One output entry per input case, keyed by the id you supplied.
- A failing case is recorded and the run continues.
- `--concurrency` (default 2) runs cases in parallel while the LLM client's own
  rate gate keeps the provider happy.

**Timing.** The committed five-case file completes in **~14 seconds** without an
API key and comfortably inside fifteen minutes with one, including retries.

**`ok` vs `failed`.** `failed` is reserved for a case that produced no kit at
all. A company site that 404s, times out or does not resolve is *not* a failure:
the description alone still yields a kit, and the gap is recorded in
`kit.warnings`. In practice only an invalid case shape or a kit that fails
structure validation produces `failed`.

---

## Architecture

```
src/
  app/
    api/
      auth/{register,login,logout,me}   session endpoints
      kits/                             GET list, POST create (streams progress)
      kits/[id]/                        GET, PATCH (save), DELETE
      kits/[id]/regenerate/             POST one section
    workspace/                          the client editor
      Workspace.tsx                     shell: kit list, selection, empty states
      KitView.tsx                       the open kit (mounted under key={kitId})
      useKitEditor.ts                   local-first edits + debounced autosave
      panels.tsx                        overview, questions, flashcards, schedule
      PracticeMode.tsx                  stepped practice + confidence ordering
      InlineEdit.tsx                    click-to-edit primitive
  lib/
    pipeline/          retrieval and generation (the only code that talks out)
      retrieve.ts      crawl, rank links, robots, SSRF guards, public discussion
      extract.ts       requirements and role details out of the description
      questions.ts     per-category question generation
      brief.ts         company brief
      flashcards.ts    recall cards
      llm.ts           rate-limited OpenAI-compatible client
      generate.ts      orchestrator: sequences the steps, runs coverage passes
    kit/               pure domain logic, no network, no React
      types.ts  coverage.ts  schedule.ts  validate.ts  merge.ts
    store/kits.ts      persistence
    auth.ts  db.ts  http.ts
scripts/
  evaluate.ts          batch entry point
  run-tests.ts         cross-platform test discovery
```

The separation that matters: **`lib/kit/` is pure.** Coverage, scheduling,
validation and the regeneration merge rule are functions over plain data with no
network, database or React dependency, which is why they are cheap to test
exhaustively. `lib/pipeline/` is the only layer that reaches the network.
`app/api/` does auth, validation and error shaping and nothing else.

---

## Retrieval

**Sources used:** the company's own website (crawled), and Hacker News via the
public Algolia API (`hn.algolia.com`) for public discussion of the company's
interview process. No job boards are fetched — the description is pasted.

**The hiring page is found, not guessed.** No path list. Instead:

1. Fetch the homepage.
2. Extract every same-origin link *with its anchor text*, resolving relative
   hrefs against the base (so a site served from `http://localhost:8099/acme/`
   works).
3. Score each link on path **and** anchor text. `how-we-hire` / `hiring-process`
   / `interview-process` score highest (30), then `careers`/`jobs` (18), then
   `join us`/`life at` (15), then `handbook`/`culture` (8). About-pages score on
   a separate scale. Deep links lose points, because `/blog/2019/...` is a post,
   not a section.
4. Fetch the best candidates, up to six company pages, 300 ms apart.
5. **Expand a careers page one level deeper.** This is the step that finds the
   pages the brief calls out: GitLab and PostHog publish their process at paths
   nobody would predict, but both are reachable from the careers page. Nested
   hiring links jump the queue.
6. Search Hacker News for `<company> interview` and `<company> hiring process`,
   keeping only hits that actually mention the company.

**robots.txt is parsed properly**, per user-agent group, with `Allow` overriding
a broader `Disallow` by specificity. A naive parser that treats any
`Disallow: /` as a site-wide block is why the earlier version silently retrieved
nothing from sites that only block other crawlers.

**Politeness and failure.** 300 ms between requests, capped retries with
exponential backoff, `Retry-After` honoured, 8 s timeout per request. Any source
that cannot be retrieved is skipped and recorded in `warnings`; the run
continues.

---

## Research and generation sequence

The kit is produced by steps that respond to what was actually found. Pasted
text needs no retrieval; a homepage needs crawling before it is useful; a hiring
page, once found, changes what questions make sense.

| # | Step | Responsibility | Model? |
| --- | --- | --- | --- |
| 1 | `researchCompany` | Crawl the site, rank links, find a hiring page, search public discussion. | No |
| 2 | `extractRequirements` / `extractRoleDetails` | Requirements with `id`/`kind`/`priority`, plus title, seniority, location, responsibilities. | Optional, grounded |
| 3 | `buildCompanyBrief` | Summarise only the pages we actually fetched. | Optional |
| 4 | `generateQuestionsForCategory` | **One call per category**, each with its own instruction and the hiring process as context. | Optional |
| 5 | `buildCoverageReport` → corrective passes | Find must-haves with no question; generate only those. | **Never** |
| 6 | `generateFlashcards` | One recall card per requirement. | Optional |
| 7 | `buildSchedule` | Allocate across exactly the days requested. | **Never** |
| 8 | `validateKit` | Full Appendix A structural check before the kit is allowed out. | No |

**Categories are genuinely separate calls.** "5+ years of React" and "mentoring
junior engineers" never come from the same call with the same instructions.
Routing: `technical` → technical questions, plus a **system-design** question
when the requirement mentions architecture or scale; `behavioural` →
behavioural; `domain` → company-fit. Each category's instruction differs — the
behavioural one demands a specific past situation, the system-design one demands
a concrete system and a named trade-off.

**The hiring page changes the questions.** When one is found its text is passed
into every category call, and a company-fit question is generated that names the
published process. Against `about.gitlab.com` the kit produces *"GitLab
publishes how it interviews. Which stage of that process would stretch you most
…"*; against a site with no hiring page, the instruction explicitly tells the
model not to speculate about their format.

**Extraction is grounded.** Requirement extraction runs the deterministic parser
*and* the model, then keeps a model requirement only if most of its content
words actually appear in the description (`isGroundedIn`). Anything ungrounded
is discarded and counted in `warnings`. Inventing requirements a description
does not contain is worse than reporting few, so the guard fails closed: if
nothing survives, the deterministic result is used.

The deterministic parser is section-aware rather than line-based. It tracks
which section it is in (`Requirements` / `Nice to have` / `Responsibilities` /
`Benefits`), honours inline labels (`Required:` … `Preferred:` in one
paragraph), strips posting framing ("We need someone to …"), splits conjoined
duties into separate requirements, and drops benefits and EEO boilerplate.
`kind` comes from vocabulary lists, not coincidence — "strong PostgreSQL and
schema design" is technical, not domain, even though it contains "design".

---

## The second pass

After the first draft, `buildCoverageReport` compares requirement ids against
the `requirement_ids` on every question — pure set arithmetic, in code, never
the model's call. Every must-have with no question is a gap.

Each corrective pass asks only for the uncovered requirements, grouped by the
category each belongs in, and **keeps only the returned questions that actually
close a gap** so a pass cannot pad the bank. Coverage is then recomputed.

**How many passes: three, and here is why.** Pass 1 is the draft; passes 2 and 3
are corrective and much smaller. In practice a targeted pass closes the gap on
the first attempt — a model that has failed twice on the same requirement is not
going to succeed on the fourth, and each pass costs tokens against a free tier.
The loop also **stops early** if a pass closes nothing, rather than burning the
remaining budget.

**A kit never ships with an uncovered must-have.** After the passes, anything
still uncovered gets a deterministic template question for its category, and the
fallback is recorded in `warnings`. `validateKit` then *refuses* a kit with an
uncovered must-have, so this cannot regress silently — and a test asserts it.

`coverage.passes` is the number of passes actually run, not a constant.

---

## Generated, edited and pinned state

The hardest state problem in the brief. Every editable item carries a `state`:

| State | Meaning | On regeneration |
| --- | --- | --- |
| `generated` | Produced by the pipeline | May be replaced |
| `edited` | The user changed it | **Kept, in place** |
| `authored` | The user wrote it from scratch | **Kept, in place** |
| `pinned` | The user locked it explicitly | **Kept**; the section refuses to regenerate |

`authored` is separate from `edited` only so the UI can explain *why* something
survived ("yours" vs "edited"); they behave identically.

Regenerating a section therefore replaces only the `generated` items **inside
that section**. Nothing outside it is touched. The rules live in
[`src/lib/kit/merge.ts`](src/lib/kit/merge.ts) as pure functions over a kit, so
they are testable without a database, a model or a browser — twelve tests cover
them.

Three details that make it feel right rather than merely correct:

1. **Position is preserved.** New questions are spliced in where the first
   replaced question sat, so the list does not reshuffle under the user.
2. **Ids never collide.** New ids continue from the highest existing `q<n>`,
   including ids the user's own additions introduced.
3. **An edit in flight is not lost.** Edits save with a 700 ms debounced
   `PATCH`. Regenerating **flushes the pending save first and awaits it**, so
   the server merges against the user's latest work rather than the version it
   happened to have. Switching kits and logging out flush too.

Everything derived is recomputed after any change (`reconcileKit`): coverage is
recalculated, dangling references are pruned, and the schedule is rebuilt —
unless the user pinned it, in which case it is kept and only pruned. The result
is validated server-side before it is stored, so a client bug cannot persist a
malformed kit.

---

## Schedule allocation

Arithmetic, in code, in [`src/lib/kit/schedule.ts`](src/lib/kit/schedule.ts).

1. Clamp days to 1–60.
2. Order questions: must-haves before nice-to-haves, then difficulty descending,
   then the requirement's order in the description (stable).
3. **More questions than days:** each day gets a contiguous slice of that
   ordering, with the remainder front-loaded, so day 1 carries the hardest
   must-haves and the tail gets lighter.
4. **More days than questions:** cover everything once, then fill the remaining
   days with spaced review that revisits the hardest material most often. This
   is the 60-day case, and it produces **zero empty days** — a test asserts it.
5. Minutes are integers: 10/15/25 per question by difficulty (halved for review
   days) plus 10 minutes of overhead, capped at 180.
6. The final day is relabelled consolidation — new material the night before an
   interview is a bad plan.

Guarantees, all covered by tests: the schedule spans exactly the days requested;
every question is scheduled at least once; every must-have appears somewhere;
every day has a focus, at least one question and a positive integer duration.

---

## Practice mode

Steps through the whole deck one card at a time, reveals on demand, records
confidence 1–3, and reports what is still shaky. Space reveals, `1`/`2`/`3`
rate, Escape exits.

**Ordering: confidence-weighted, not spaced repetition.** Cards never seen come
first (an unknown is riskier than a known weakness), then lowest confidence,
ties broken by oldest review. SM-2 style intervals optimise for long-term
retention over weeks; with an interview in five days the scarce resource is
attention, not retention, so the simpler sort is the better fit. The deck order
is fixed when a session opens so rating a card does not reshuffle it underfoot.

Confidence ratings are practice data, not edits: they never mark a card
`edited`, so practising does not lock a card against regeneration.

---

## Edge cases and failure handling

| Case | Behaviour |
| --- | --- |
| Invalid URL | Rejected before any fetch, with a structured `INVALID_URL`. |
| 404 / timeout / DNS failure | Retries with backoff, then builds the kit from the description alone. Recorded in `warnings`. Still `ok`. |
| No hiring or about page | Recorded honestly; the question instruction tells the model not to speculate about their format. |
| Two-line stub description | A thin kit that says so. `warnings` states how few requirements were readable. Nothing is padded. |
| No public discussion found | Recorded in `warnings`; the brief does not pretend otherwise. |
| Invalid JSON from the model | Balanced-brace scanner recovers JSON from fenced or prose-wrapped replies; a genuinely unparseable reply retries, then falls back to the deterministic path for that step only. |
| Incomplete kit from the model | Every model response is parsed field by field; anything malformed is dropped and the step falls back. `validateKit` is the final gate. |
| Rate limited (429) or provider blip | Shared concurrency gate + sliding requests-per-minute window; `Retry-After` honoured, exponential backoff with jitter, capped retries. Degrades to templates rather than failing the kit. |
| Same description and company twice | A `sha256(jd + url + days)` fingerprint returns the existing kit instead of generating again. |
| 1-day or 60-day schedule | Both produce exactly that many days with no empty days. Values outside 1–60 are clamped. |
| Generation takes 90 s | `POST /api/kits` streams NDJSON progress, so the UI shows the running step rather than a spinner. Vercel's function limit is the real ceiling — see limitations. |
| Generation triggered twice | The fingerprint check makes the second request a read. |
| Database unreachable | Structured `DATABASE_UNAVAILABLE` with a message that names the likely cause. The batch path does not touch the database at all. |

---

## Security

- **Session auth.** scrypt password hashing with a per-user salt and
  `timingSafeEqual` comparison; opaque session tokens in an `httpOnly`,
  `sameSite=lax`, `secure`-in-production cookie; sessions stored server-side
  with expiry and deleted on logout. Middleware guards pages; **every** API
  handler re-checks the session itself and scopes every query by `userId`, so a
  user cannot read or modify another's kits by guessing an id.
- **SSRF.** URLs are validated (http/https only), the host is resolved, and
  loopback, private, link-local (including `169.254.169.254`), CGNAT, multicast
  and reserved ranges are rejected. Checking the *resolved address* rather than
  the hostname is what stops a public name pointing at internal infrastructure.
  Private targets are permitted outside production because the batch harness may
  serve sites from localhost; `ALLOW_PRIVATE_CRAWL_TARGETS=false` forces the
  check on.
- **Content type and size.** Only `text/html`, `text/plain` and
  `application/xhtml+xml` are processed. `Content-Length` is checked and the
  body is read through a capped streaming reader, so a declared-small,
  actually-huge response cannot exhaust memory. Page text is truncated to 12 kB.
- **Prompt injection.** Every untrusted input — the pasted description and every
  crawled page — is wrapped in a `<label id="<random nonce>">` fence, with the
  nonce stripped from the content so it cannot be spoofed. The system prompt
  states that fenced content is data to be described and never instructions to
  follow. Defence in depth matters more than the fence: model output is parsed
  field by field against an expected shape, requirements must be grounded in the
  description, and `validateKit` gates the result — so a page that talks the
  model into something still cannot produce a malformed or fabricated kit.
- **Input validation.** Request bodies are validated and bounded (60 kB
  description cap, days 1–60) before any work begins.

---

## Tests

```bash
npm test        # 68 tests, offline
npm run lint
npm run build
```

Covering, in the brief's order of priority:

- **Schedule allocation** — exact day count for 1/2/3/7/14/30/60 days, no empty
  days when days exceed questions, every question scheduled, every must-have
  present, integer minutes, hardest-first ordering.
- **Coverage checking** — uncovered must-haves found, nice-to-haves reported
  separately, multi-requirement questions, dangling references, empty inputs.
- **Structure validation** — every Appendix A field, enum membership, id
  uniqueness, referential integrity, integer durations, sequential day numbers,
  and the two cross-cutting guarantees.
- **The regeneration merge rule** — edited, authored and pinned questions
  survive; other categories are untouched; position is preserved; ids never
  collide.
- **Requirement extraction** — must/nice from sections and inline labels,
  benefits excluded, responsibilities separated, thin stubs, prose duties,
  classification, and the grounding guard.
- **Retrieval safety** — private-address detection, protocol validation,
  per-user-agent robots parsing, link scoring, relative-link resolution, HTML
  cleaning, and JSON recovery from messy model output.

---

## Design decisions and trade-offs

**A deterministic floor under every model call.** Each step degrades on its own
rather than the pipeline failing as a unit. The cost is two implementations of
some steps; the benefit is that a rate limit degrades wording, not structure,
and that the whole thing is testable and runnable without a key.

**Coverage and scheduling are code, never prompts.** The brief asks for this,
but it is also the right call: both are set arithmetic and allocation, where a
model's output would have to be verified anyway.

**Grounding over trust.** A model asked for requirements will happily produce
plausible ones. Checking its output against the source text is cheap and turns
"probably did not hallucinate" into a property the code enforces.

**Streaming progress instead of a job queue.** A generation takes 20–60 seconds.
A durable queue with polling would survive a closed tab, but it needs a worker,
a job table and a state machine. Streaming NDJSON from the request gives honest
per-step progress for the cost of one `ReadableStream`, and the fingerprint
check makes a retry cheap. The trade-off is a closed tab loses the run.

**Local-first editing with debounced saves.** Typing and reordering never wait
on the network; state is reconciled server-side on save. The trade-off is
last-write-wins across two tabs — acceptable for a single-user prep tool, and
mitigated by flushing before any regeneration.

**Remount-by-key instead of state-syncing effects.** `KitView` is mounted under
`key={kitId}`, so switching kits discards the previous draft, timer and save
status through React rather than through a hand-written effect.

**Kits are whole documents.** A kit is read and written as one document rather
than normalised into questions/flashcards/schedule collections. Regeneration and
reconciliation are whole-kit operations, so this keeps them atomic. It would not
scale to collaborative editing, which is out of scope.

---

## Known limitations

- **No headless browser.** A company whose homepage renders entirely
  client-side yields little text. This is reported honestly rather than
  papered over, but a JS-heavy marketing site produces a thinner brief.
- **Public discussion is Hacker News only.** Reddit and Glassdoor either block
  automated access or forbid it in their terms. The result is thin coverage for
  companies that are not discussed on HN — reported in `warnings`.
- **Vercel's function timeout is the real ceiling** on generation. Handlers set
  `maxDuration = 60`. Without a key, generation takes 3–7 seconds; with one it
  is usually 20–40, but an unusually large posting plus a slow provider could
  reach the limit. The batch command has no such limit.
- **The extractive brief quotes, it does not summarise.** Without an API key,
  `how_they_hire` can include navigation text from the fetched page. It is
  labelled as quoted so it is never mistaken for a written summary.
- **Requirement extraction is tuned for English-language postings** and caps at
  14 requirements.
- **Last-write-wins** if the same kit is edited in two tabs at once.
- **No email verification or password reset** — explicitly out of scope.
