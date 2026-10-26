# Warehouse Receiving System — agent instructions

You are implementing a specified system, not designing one. The specs are the source of truth.

## Sources of truth (read the sections your task points to, not everything)
- `docs/prd.md` — WHAT: requirements (FR-xx), business rules (BR-xx), acceptance criteria (AC-xx.x)
- `docs/technical-spec.md` — HOW: stack, DDL (§3.2), receipt transaction (§6), state machine (§7), auth matrix (§8)
- `docs/openapi.yaml` — exact request/response shapes and error codes. Match it field for field.
- `docs/tasks.md` — the ordered task list. Work on ONE task at a time.

## Rules
- IMPORTANT: Never invent business behaviour. If the specs are silent or contradict each other, stop and ask. If you must choose to keep going, pick the simplest option and record it in `docs/ai-workflow.md` → "Decisions made during implementation".
- Every business rule is enforced in the backend. Frontend validation is a convenience only.
- Only `ReceiptsService.recordReceipt`, `ReceiptsService.reverseReceipt` (and product creation's zero balance) may write `inventory_balances` or `inventory_transactions`.
- Receipt, reversal, open, complete, close short, cancel and line edits run in one DB transaction and lock in this order: document → item → balance (`SELECT … FOR UPDATE` via `tx.$queryRaw`).
- Do not add features, endpoints, fields or libraries that are not in the specs.
- Do not mock the database in integration tests. Use the real `wrs_test` PostgreSQL database.
- Name tests after the rule they prove: `it('BR-07 rejects receipt above remaining quantity', …)`.
- Never commit secrets. Configuration comes from env vars; only `.env.example` is committed.

## Commands (run from the folder shown)
- Start database for dev/tests: `docker compose up -d db` (repo root)
- Backend: `npm run start:dev`, `npm run lint`, `npm run build`, `npm test`, `npx prisma migrate dev`, `npx prisma db seed` (`backend/`)
- Frontend: `npm run dev`, `npm run lint`, `npm run build`, `npm test` (`frontend/`)
- Full stack: `docker compose up --build -d`, then `curl localhost:8080/health`
- E2E: `npm run test:e2e` (repo root, stack running)

## Gotchas
- Prisma cannot express CHECK constraints or `lower()` indexes: add them by hand to the generated `migration.sql` (spec §3.3). Never edit an applied migration; create a new one.
- `inventory_transactions.id` is bigint: serialize it as a string in JSON.
- Map Prisma `P2002` by constraint name (see spec §4.3); a CHECK violation reaching the filter is a bug → 500 + log.
- Token lives in `sessionStorage`; the frontend calls the API at the relative path `/api/v1` (Vite dev proxy and nginx both forward it).

## Workflow for each task
1. Read the task in `docs/tasks.md` and only the spec sections it references.
2. Write or update the tests listed in the task first, then implement.
3. Run the task's verify command and show the output. Fix until it passes. Do not weaken a test to make it pass.
4. Tick the task's checkbox in `docs/tasks.md`.
5. Commit with Conventional Commits: `feat(receiving): T014 record receipt transaction`.
