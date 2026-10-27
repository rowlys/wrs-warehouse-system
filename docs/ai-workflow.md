# AI Agent Workflow

| Field | Value |
|---|---|
| Agent | Claude Code (CLI), working in this repository |
| Method | Spec-driven development: specify → plan → tasks → implement → verify |
| Project instruction files | [`CLAUDE.md`](../CLAUDE.md), [`.claude/skills/implement-task/SKILL.md`](../.claude/skills/implement-task/SKILL.md), [`.claude/agents/spec-reviewer.md`](../.claude/agents/spec-reviewer.md) |

## 1. Why spec-driven instead of prompt-by-prompt

When you add features one prompt at a time, the agent's understanding of the business lives only in the chat. It forgets earlier decisions as the conversation grows, fills gaps with plausible guesses, and nothing records why the code behaves the way it does.

Spec-driven development moves that understanding into version-controlled files. The agent reads the specification before it writes anything, and the human's job shifts from steering line by line to writing precise requirements and reviewing results against them. The approach became mainstream through GitHub's open-source Spec Kit, which organizes the work into gated phases (specify, plan, tasks, implement) where you do not move on until the current phase is checked.

Two practical constraints from the Claude Code documentation shaped this setup:
- **Context is the scarce resource.** Output quality drops as a session fills up, so each task runs in a fresh session and reads only the spec sections it needs.
- **The agent needs a check it can run.** Without tests, "looks done" is the only signal and the human becomes the verification loop. Every task here has a verify command that returns pass or fail.

## 2. How the documents map to the workflow

| Spec Kit phase | Purpose | File in this repo | Written by |
|---|---|---|---|
| Constitution | Non-negotiable project rules | `CLAUDE.md` | Candidate, AI-assisted |
| Specify | What and why, no technology | `docs/prd.md` | Candidate, AI-assisted, reviewed line by line |
| Plan | How: architecture, data, contracts | `docs/technical-spec.md`, `docs/erd.mmd`, `docs/openapi.yaml`, `docs/*.mmd` | Candidate, AI-assisted, reviewed |
| Tasks | Ordered, testable units of work | `docs/tasks.md` (T001–T025) | Candidate, AI-assisted |
| Implement | Code, one task at a time | `backend/`, `frontend/`, Docker files | Claude Code via `/implement-task` |
| Verify | Evidence the code meets the spec | tests, `docs/testing.md`, `spec-reviewer` subagent | Claude Code + candidate review |

Spec Kit itself was not installed: its folder layout (`.specify/`, `specs/<feature>/`) would conflict with the `/docs` structure the assessment asks for, and one project with one feature set does not need its feature-branch machinery. The same phases and gates are reproduced with plain files.

**Traceability chain.** `BR-07` in the PRD → technical spec §6 step 9 → OpenAPI `422 QUANTITY_EXCEEDS_REMAINING` → task T012 → test named `BR-07 …`. Any rule can be followed from requirement to code to test by searching its ID.

## 3. The implementation loop (one task)

```
┌─ fresh session (/clear) ───────────────────────────────────────────┐
│ 1. Plan mode (Shift+Tab)  →  /implement-task T012                  │
│ 2. Agent reads task + referenced spec sections, proposes a plan    │
│ 3. Human reviews plan: right files? right rules? anything invented?│
│ 4. Approve → agent writes tests first, sees them fail              │
│ 5. Agent implements, runs Verify, iterates until green             │
│ 6. Agent reports "Done when" item by item, ticks task, commits     │
│ 7. Human skims the diff (git show), runs Verify once more          │
└────────────────────────────────────────────────────────────────────┘
At review gates 🔍: "Use the spec-reviewer subagent to review T009–T016"
```

Rules of thumb used:
- **One task per session.** `/clear` between tasks so earlier work does not crowd the context.
- **Plan mode for anything touching business rules** (T007–T015, T020–T021). Small scaffolding tasks skip it.
- **Stop early.** Press `Esc` as soon as the agent drifts. After two failed corrections on the same issue, `/clear` and restart the task with a sharper prompt that includes what was learned.
- **Never accept a weakened test.** If the agent wants to change a test, it must say why the test is wrong according to the spec.
- **Writer and reviewer are different contexts.** The `spec-reviewer` subagent sees only the diff and the specs, not the reasoning that produced the code.
- **Specs change first, code second.** See §5.

## 4. Planned session schedule (one day)

| Time | Work | Tasks |
|---|---|---|
| 0:00–2:30 | Write and review PRD, technical spec, OpenAPI, diagrams, tasks, CLAUDE.md | (docs) |
| 2:30–3:15 | Scaffolding | T001 |
| 3:15–4:30 | Backend foundation + gate 1 | T002–T006 |
| 4:30–7:00 | Business logic + gate 2 | T007–T016 |
| 7:00–9:15 | Frontend + gate 3 | T017–T022 |
| 9:15–10:30 | Docker, E2E | T023–T024 |
| 10:30–11:30 | Evidence, README, final review | T025 |
| 11:30–12:00 | Buffer | |

## 5. Handling a requirement change

The technical review may ask for a change on the spot (for example "allow 5% over-delivery"). The flow is the same as for new work, just smaller:

1. Update `docs/prd.md` (new/changed BR and AC, remove the matching Q or A).
2. Update `docs/technical-spec.md`, `docs/openapi.yaml` and the ERD if the data or contract changes.
3. Add a task `T0xx` to `docs/tasks.md` with refs, tests and verify.
4. Run `/implement-task T0xx` in plan mode.
5. Run the full suite and `spec-reviewer`.

Prompt P7 below is the template.

## 6. Prompt library

These are the prompts and task instructions used with the agent. They work together with the documents: each one points the agent at specific files and IDs rather than re-describing the business in the prompt.

### P1 — Drafting the specification (before any code)
Used in a chat assistant with the assessment PDF attached, to produce first drafts of the docs. The drafts were then reviewed and edited by the candidate.
```
I applied for a fullstack developer internship and received this technical test.
Let's ready the necessary documents and AI workflow first. Research online to find
out the best spec-driven workflow, since I usually prompt features one by one.
Stack: NestJS + React + PostgreSQL. Agent: Claude Code.
```

### P2 — Spec self-check before implementation
```
Read docs/prd.md, docs/technical-spec.md and docs/openapi.yaml. Do not write code.
List every place where:
1. a PRD requirement (FR/BR/AC) has no matching endpoint, constraint or test in the
   spec, the OpenAPI file or docs/tasks.md;
2. the documents contradict each other (status codes, error codes, field names,
   roles);
3. an implementer would have to guess business behaviour.
Output a table: ID | problem | file:section | suggested fix. Do not fix anything yet.
```

### P3 — Running a task (every implementation task)
```
/implement-task T012
```
The skill expands this into: read the task and only its referenced sections → plan → tests first → implement → verify with output → report "Done when" → tick → commit.

### P4 — The critical receipt transaction (T012, extra context added to P3)
```
/implement-task T012
Extra constraints for this task:
- Follow technical-spec §6 steps 4–14 in order; put a comment with the step
  number above each block so the code can be traced back to the spec.
- Use prisma.$transaction(async (tx) => ...) and tx.$queryRaw for the two
  SELECT ... FOR UPDATE statements; lock document first, then item.
- Do not compute the new balance in TypeScript; use UPDATE ... RETURNING.
- After the tests pass, show me the final recordReceipt function in full and
  explain in 5 bullets why two concurrent receipts on the same line cannot
  over-receive.
```

### P5 — Independent review at a gate
```
Use the spec-reviewer subagent to review tasks T009–T016
(git diff <commit-of-T008>..HEAD -- backend). Then fix every GAP it reports,
one commit per fix, and add a row per finding to docs/ai-workflow.md §7.
Ignore style-only remarks.
```

### P6 — Debugging a failing check
```
The concurrency test T-CON-01 fails intermittently (2 of 10 runs).
Output of the failing run:
<paste>
Do not change the test. Find the root cause in receipts.service.ts against
technical-spec §6 (lock order and the remaining-quantity check), explain it,
write the fix, then run the 10-run loop from tasks.md T014 and show the output.
```

### P7 — Requirement change (technical review)
```
Requirement change: <describe the change>.
1. Update docs/prd.md (rules + acceptance criteria), docs/technical-spec.md and
   docs/openapi.yaml. Show me the doc diff and wait for my approval.
2. After approval, add task T026 to docs/tasks.md and run /implement-task T026.
```

## 7. Prompt log and review findings

Filled in during implementation. One row per meaningful prompt or correction.

| # | Task | Prompt (short) | What the agent produced | What I checked / corrected |
|---|---|---|---|---|
| 1 | docs | P1 | First drafts of all `/docs` files and `CLAUDE.md` | (fill in: edits you made to the drafts) |
| 2 | docs | P2 | | |
| 3 | docs | P7: resolve Q-01 (close short) and Q-02 (receipt reversal) | PRD v1.1 (FR-35–37, BR-17–19, US-08/09, A-13–15), spec §6.1/§6.2/§7 + DDL, OpenAPI 1.1.0, ERD/state/data-flow diagrams, tasks T026–T028, test catalogue | Agent asked two gaps before writing: close short with nothing short → 422 `NOTHING_SHORT`; reversal leaving nothing received → back to `OPEN`. Agent also found T014 described "two lines of the same product" in one document, which BR-06 forbids; fixed to two documents |
| 4 | T016 | P5: `spec-reviewer` over the whole backend (T001–T015, T026, T027) | Table of every FR/BR/AC and openapi operation: 2 GAP, 1 NOT TESTED, rest OK | (1) GAP BR-09: concurrent identical receipt for the whole remaining quantity → 422 instead of 200 replay (and 422 instead of 409 for the same key with another quantity); reproduced 5/5. Fixed by taking the document lock before the key lookup; two race tests added to `idempotency.spec.ts`. (2) GAP §4.2: malformed JSON body → `VALIDATION_ERROR` without `details.fields`; filter now adds `fields: []`, unit test added. (3) NOT TESTED §4.3 `receipt_reversals.receipt_id` P2002 → 409: unit test added (mapping was already right). Re-review of the fixes: no GAP; it flagged two paths the reorder left untested (replay on a `COMPLETED` document; the step 15 P2002 retry, now only reached when one key races on two documents), both now tested. Disabling the retry makes the new test fail |

### AI mistakes caught

| Task | Mistake | How it was caught | Fix |
|---|---|---|---|
| T012/T013 | Idempotency key looked up before the document lock (as spec §6 orders steps 5 → 6), so a duplicate that raced the first request saw "0 remaining" and got 422; the concurrent test only received 10 of 100, so it never hit this path | Repo audit, then confirmed by the `spec-reviewer` in T016 with a throwaway probe | Lock first, then look up the key; tests now race the full remaining quantity |
| T016 | Contract test first asserted 21 operations; spec §4.1 and openapi have 20 | The test itself failed on first run | Count corrected to 20 |

## 8. Decisions made during implementation

Decisions the specs did not cover, recorded by the agent (per `CLAUDE.md`) or by the candidate.

| Date | Task | Decision | Reason |
|---|---|---|---|
| 2026-10-26 | T001 | `.env.example` sets `DATABASE_URL` host to `localhost`, not `db` as in spec §10 example | Backend dev and integration tests run on the host against the published `127.0.0.1:5432`; the api container will set host `db` when that service is added |
| 2026-10-26 | T002 | HttpExceptions with a 4xx status other than 400/401/403/404 (e.g. 413 payload too large) keep their status and use `VALIDATION_ERROR` | `ErrorCode` has no generic client-error code; the request itself is unacceptable, matching the 400 "malformed request" meaning |
| 2026-10-26 | T002 | P2002 is mapped when `meta.target` equals the constraint name or its column list | Prisma reports either form depending on the index; the integration tests in T007/T010/T027 confirm the real value |
| 2026-10-26 | T003 | Host-side Prisma CLI and backend read a git-ignored `backend/.env` (copy of root `.env` with `localhost` DB host); root `.env` stays for Docker Compose | Prisma only loads `.env` from the backend project folder, not the repo root; no extra dotenv dependency |
| 2026-10-26 | T003 | Unique keys are Prisma unique indexes (`products_sku_key`, `ri_document_product_uq`, …) rather than inline `UNIQUE` constraints as written in §3.2 | Prisma always emits unique indexes; names, enforcement and the P2002/23505 error are identical. Verified by diffing `pg_dump` of the migration against the §3.2 DDL: only this and `now()`≡`CURRENT_TIMESTAMP` differ |
| 2026-10-26 | T003 | Seed upserts never update existing rows (`update: {}`); changing `SEED_*_PASSWORD` does not re-hash an existing user | Spec only requires no duplicates; leaving rows untouched is the simplest idempotent behaviour |
| 2026-10-26 | T004 | Jest global setup runs `prisma migrate deploy` on `wrs_test`, not `migrate reset --force --skip-seed` (spec §3.3.7); `truncateAll()` in `beforeEach` gives the clean state | Chosen by the candidate: Prisma blocks `migrate reset` when run by an AI agent; deploy is non-destructive and truncation already isolates tests. Harness refuses any database other than `wrs_test` |
| 2026-10-26 | T004 | `loginAs(role)` signs a JWT with the spec §8 claims (`sub`, `username`, `role`) instead of calling `POST /auth/login`; factories write through Prisma | Login (T006) and document endpoints (T009/T011) do not exist yet; the real login flow is tested in T006 |
| 2026-10-26 | T004 | Jest runs with `maxWorkers: 1` and `testTimeout: 20000` | All test files share one database and truncate it, so files must not run in parallel; the timeout gives app start-up headroom on a cold first run |
| 2026-10-26 | T006 | `JwtAuthGuard` verifies tokens with `@nestjs/jwt` `JwtService` (HS256 pinned for sign and verify); `passport-jwt` from spec §0 is not used | Same behaviour with one library instead of four (`@nestjs/passport`, `passport`, `passport-jwt`, types); errors map straight to the envelope without a Passport strategy |
| 2026-10-26 | T007 | P2002 is matched by `meta.modelName` + column list (or constraint name); fixes the T002 mapping | Probed against real PostgreSQL: Prisma 6 reports `{modelName, target: [db columns]}`, never the constraint name. `receipt_id` is unique in both `receipt_reversals` and `inventory_transactions`, so columns alone would mislabel a ledger bug as 409 `RECEIPT_ALREADY_REVERSED` |
| 2026-10-26 | T007 | Only SKU and product name are trimmed; unit of measure and description are stored as sent. Product lists sort `createdAt DESC, id DESC` | BR-01/BR-03 only require trimming SKU and name; the `id` tie-break keeps pages stable when timestamps are equal |
| 2026-10-26 | T009 | Local `DATABASE_URL` host is `127.0.0.1`, not `localhost` (supersedes the T001 row) | Found when concurrent creates failed with "Unable to start a transaction": `localhost` resolves to `::1` first, the db is published on IPv4 only (spec §11), so every new connection waited ~2 s and blew Prisma's 2 s `maxWait` |
| 2026-10-26 | T009 | Document number year is the UTC year at creation | FR-22 says "creation year"; all timestamps are UTC (spec §3.1) |
| 2026-10-26 | T009 | Detail lines are ordered `created_at ASC, product SKU ASC`; receipts `received_at ASC, id ASC` | Lines created in one transaction share `created_at`; SKU gives a stable, readable order. Receipts "oldest first" per OpenAPI |
| 2026-10-26 | T009 | Supplier name, reference and notes are stored as sent (not trimmed); a duplicate product in the create payload is rejected before insert, unknown products return `details.productIds` | BR-04 does not ask for trimming (BR-03/BR-15 say so explicitly where wanted); pre-checks give deterministic 409/422 instead of relying on a nested-write error |
| 2026-10-26 | T010 | Adding, changing or removing a line does not touch the document row's `updated_at`; the line carries its own `updated_at` | Spec is silent; the document row is only locked, not written, which keeps line edits to the §6.1 steps |
| 2026-10-27 | T011 | Both 409 status errors (`INVALID_STATUS_TRANSITION`, `INVALID_DOCUMENT_STATUS`) carry `details: {currentStatus, action}` | OpenAPI shows these details for `INVALID_STATUS_TRANSITION`; using the same shape for both keeps one rule in `assertCan` and gives the UI the current status either way |
| 2026-10-27 | T013 | An idempotent replay returns the original `receipt`, but `item`, `document` and `inventory` show the current state | The schema stores no response snapshot (spec §3.2); the receipt itself is immutable, so it is the "original result". Tested: a replay after the line was filled shows received 100 |
| 2026-10-27 | T016 | Swagger UI is `swagger-ui-express`, pointed at the raw `docs/openapi.yaml` (served at `/api/docs/openapi.yaml`); `@nestjs/swagger` is not used | Spec §0 serves the hand-written contract; Swagger UI parses the YAML itself, so no decorators, generated spec or YAML parser are needed. The file is resolved as `<backend>/../docs/openapi.yaml`, so the T023 image must put it there |
| 2026-10-27 | T016 | Receipt transaction takes the document lock (§6 step 6) before the idempotency lookup (step 5); the step 15 P2002 retry stays for the same key on another document's line | BR-09 must hold for concurrent duplicates: under READ COMMITTED the lookup after the lock sees a receipt the first request just committed. Replays now wait for the document lock, which is held only for one short transaction. A replay sent with an unknown `documentId` now gets 404 (the §6 step 6 failure) instead of a 200 replay |
| 2026-10-27 | T016 | An HttpException that maps to `VALIDATION_ERROR` (malformed JSON, 413) gets `details: { fields: [] }` | §4.2 says `VALIDATION_ERROR` details are `{ fields: [...] }`; a malformed body names no field, and the parser message stays in `message` |
| 2026-10-27 | T016 | Contract test reads `paths:` of `openapi.yaml` with a two-level line parser instead of a YAML library; the "copy openapi.yaml into the image" part of T016 moves to T023 | No YAML library is in the specs (`js-yaml` is only a transitive dependency); no Dockerfile exists until T023, see the T016 Swagger row for the path the image must use |
| 2026-10-27 | T015 | Transaction filters `from`/`to` accept any strict ISO 8601 value, so a plain date such as `2026-10-27` means UTC midnight; impossible dates (`2026-02-30`) are 400 | openapi says `date-time` but is silent on date-only input; accepting it is the simplest reading and the frontend date picker can send either |
| 2026-10-27 | T017 | The client redirects to `/login` only on 401 `UNAUTHENTICATED`; 401 `INVALID_CREDENTIALS` stays on the login page. Routes of later tasks (detail page T020, inventory pages T022) render a placeholder heading until those tasks land | AC-01.2 needs the login error shown, AC-01.3 needs the redirect; placeholders keep the nav from T017 working without pulling later tasks in |
| 2026-10-27 | T020 | "Open for receiving" is shown on every DRAFT, even one with no lines; the 422 `DOCUMENT_HAS_NO_ITEMS` message is shown when it fails. Complete is shown only when `allItemsReceived` | The task ties the Complete button to `allItemsReceived` but names no guard for Open; showing it keeps the rule in one place (the API) and the error tells the supervisor what to do |
| 2026-10-27 | T021 | The receive field shows "Only N remaining" and disables Receive above the line's remaining quantity instead of clamping the typed value; a 422 shows `details.remainingQuantity` the same way and refetches the document. A successful receipt invalidates the query keys `['document', id]`, `['documents']`, `['inventory']` and `['transactions']`, which the T022 pages must use | Clamping would silently change what the operator counted; the keys are fixed here so T022 pages refresh after a receipt |
| 2026-10-27 | T022 | The transaction date filters are local calendar days, both inclusive: `from` is sent as local midnight of that day, `to` as local midnight of the next day (the API's `to` is exclusive), both as UTC ISO timestamps. Filters live in the URL query string; all timestamps in the UI show as local `YYYY-MM-DD HH:mm` | Users think in local days; sending full timestamps with `Z` avoids the server-time-zone reading of offset-less values. URL filters let each inventory row link to its product's transactions |

## 9. References

- GitHub Spec Kit — https://github.com/github/spec-kit
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- D. B. Piskala, *Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants*, arXiv 2602.00180 (2026)
