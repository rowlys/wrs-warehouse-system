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
| 4 | | | | |

### AI mistakes caught

| Task | Mistake | How it was caught | Fix |
|---|---|---|---|
| | | | |

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

## 9. References

- GitHub Spec Kit — https://github.com/github/spec-kit
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- D. B. Piskala, *Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants*, arXiv 2602.00180 (2026)
