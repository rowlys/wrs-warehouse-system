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
| 3 | | | | |

### AI mistakes caught

| Task | Mistake | How it was caught | Fix |
|---|---|---|---|
| | | | |

## 8. Decisions made during implementation

Decisions the specs did not cover, recorded by the agent (per `CLAUDE.md`) or by the candidate.

| Date | Task | Decision | Reason |
|---|---|---|---|
| | | | |

## 9. References

- GitHub Spec Kit — https://github.com/github/spec-kit
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- D. B. Piskala, *Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants*, arXiv 2602.00180 (2026)
