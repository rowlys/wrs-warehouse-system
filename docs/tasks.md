# Implementation Tasks — Warehouse Receiving System

Derived from [prd.md](prd.md) and [technical-spec.md](technical-spec.md). The agent works through these **one at a time, in order**, using `/implement-task <ID>` (see `.claude/skills/implement-task/SKILL.md`). Each task ends with a passing verify step and one commit.

**Format of a task**
- **Refs** — the only spec sections to read for this task
- **Depends** — tasks that must be ticked first
- **Tests** — written before the implementation
- **Verify** — commands whose output proves the task works
- **Done when** — checklist the agent reports against

Task IDs are stable. T026–T028 were added with PRD v1.1 (close short, receipt reversal) and sit in the phase where they run, not in numeric order.

Review gates (🔍) are points where the human reviews the diff, optionally runs the `spec-reviewer` subagent, and only then continues.

---

## Phase 0 — Scaffolding

### [x] T001 Repository and project scaffolding
- **Refs:** technical-spec §0, §1.2, §1.3, §10, §12
- **Depends:** —
- **Work:** `.gitignore` (node_modules, dist, .env, coverage, playwright reports); `.env.example` with every variable from spec §10 and placeholder values; `docker-compose.yml` with the `db` service only (postgres:16-alpine, named volume, `pg_isready` healthcheck, port 5432 published for local dev) bound to `127.0.0.1:5432` for local dev, plus `docker/db-init/` script that also creates the `wrs_test` database; NestJS app in `backend/` (strict TS, ESLint, Prettier, Jest); Vite React TS app in `frontend/` (strict TS, ESLint, Vitest) with a dev proxy forwarding `/api` and `/health` to `http://localhost:3000`. Remove scaffold demo code.
- **Tests:** none (build only).
- **Verify:** `docker compose up -d db && docker compose ps` shows db healthy; `cd backend && npm run build && npm run lint`; `cd frontend && npm run build && npm run lint`.
- **Done when:** both apps build and lint cleanly; no secret values committed; folder layout matches spec §1.2/§1.3.

## Phase 1 — Backend foundation

### [x] T002 Config, global pipes and error envelope
- **Refs:** technical-spec §4.2, §4.3, §10, §12; openapi `components.schemas.ErrorResponse`, `ErrorCode`
- **Depends:** T001
- **Work:** typed config module that validates env vars at startup (fails fast if `DATABASE_URL` missing or `JWT_SECRET` < 32 chars); global prefix `/api/v1` (excluding `/health`); global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) whose errors become `VALIDATION_ERROR` with `details.fields[]`; `ErrorCode` enum; `AppError(code, httpStatus, message, details?)`; global exception filter producing the envelope for AppError, HttpException, Prisma known errors (spec §4.3 mapping) and unknown errors (500 `INTERNAL_ERROR`, logged with stack). Request logging middleware (method, path, status, ms; never bodies).
- **Tests:** unit tests for the filter: AppError → its status/code; validation error → 400 shape; P2002 on `products_sku_key` → 409 `DUPLICATE_SKU`; unknown error → 500 with generic message.
- **Verify:** `cd backend && npm test -- errors`
- **Done when:** every error leaves the API in the spec §4.2 shape; config errors stop startup with a clear message.

### [ ] T003 Database schema, migration and seed
- **Refs:** technical-spec §2, §3 (all); prd BR-01, BR-12, BR-13
- **Depends:** T001
- **Work:** `prisma/schema.prisma` matching DDL §3.2 exactly (names via `@@map`/`@map`, enums, lengths, `Timestamptz`, unique and composite unique, indexes). Generate the `init` migration with `--create-only`, then append every CHECK constraint, the `lower()` indexes, the sequence and `pgcrypto` exactly as in §3.2. `prisma/seed.ts` per §3.4 using upserts, reading passwords from env and failing if unset. `PrismaService` module.
- **Tests:** integration test `schema.spec.ts` that queries `pg_constraint` and asserts each named CHECK constraint from §3.2 exists; tries to insert `received_quantity > expected_quantity` and a negative balance directly with SQL and expects failure.
- **Verify:** `cd backend && npx prisma migrate reset --force && npx prisma db seed && npx prisma db seed` (second seed must not duplicate) `&& npm test -- schema`
- **Done when:** migration applies on an empty DB; seed is idempotent; constraint tests pass.

### [ ] T004 Integration test harness
- **Refs:** technical-spec §3.3 (point 7), §9
- **Depends:** T002, T003
- **Work:** Jest config for integration tests using `DATABASE_URL` of `wrs_test` (from `.env.test`, git-ignored, with `.env.test.example` committed); global setup running `prisma migrate reset --force --skip-seed` once; helpers in `backend/test/helpers/`: `createTestApp()` (real Nest app, same global pipes/filters as `main.ts`), `truncateAll()`, `createUser(role)`, `loginAs(role)` → token, factories `createProduct()`, `createDraftDocument(lines)`, `openDocument()`, and `assertInventoryConsistent()` which checks BR-12 (balance = Σ ledger per product, never negative) and BR-13 (received = Σ unreversed receipts per line, 0 ≤ received ≤ expected) across the whole DB.
- **Tests:** a smoke test using every helper.
- **Verify:** `cd backend && npm test -- harness`
- **Done when:** tests run against a real database, isolated per test via truncation, and finish in < 30 s.

### [ ] T005 Health endpoint
- **Refs:** prd FR-50, US-07; technical-spec §4.1; openapi `/health`
- **Depends:** T004
- **Work:** `GET /health` (public, no prefix) running `SELECT 1`; 200 `{status:"ok",database:"up"}` or 503 `{status:"error",database:"down"}`.
- **Tests:** `AC-07.1` 200 with DB up. `AC-07.2` 503 when the Prisma query throws (override the provider in the test module).
- **Verify:** `cd backend && npm test -- health`
- **Done when:** both cases pass; endpoint needs no token.

### [ ] T006 Authentication and role-based authorization
- **Refs:** prd FR-01–FR-05, US-01, NFR-02; technical-spec §8; openapi `/auth/*`
- **Depends:** T004
- **Work:** `POST /auth/login` (bcrypt compare, same 401 `INVALID_CREDENTIALS` for unknown user and wrong password), `GET /auth/me`; JWT with `sub`, `username`, `role`; global `JwtAuthGuard` with `@Public()` opt-out; `RolesGuard` + `@Roles()`; `@CurrentUser()` decorator.
- **Tests:** `AC-01.1`, `AC-01.2` (both wrong user and wrong password give identical bodies), `AC-01.3` (no token, malformed token, expired token → 401 `UNAUTHENTICATED`), `AC-01.4` (operator on a dummy supervisor-only route → 403 `FORBIDDEN`).
- **Verify:** `cd backend && npm test -- auth`
- **Done when:** all AC-01 criteria pass.

🔍 **Gate 1:** review foundation diff (`git diff <T001 commit>..HEAD -- backend`). Check error envelope and migration SQL by eye.

## Phase 2 — Backend business logic

### [ ] T007 Products
- **Refs:** prd FR-10–FR-13, BR-01–BR-03, US-02; technical-spec §5 (Create product); openapi `/products*`, schemas `CreateProductRequest`, `Product`
- **Depends:** T006
- **Work:** list (pagination, search on SKU/name, newest first), get by id (with `quantityOnHand`), create (SUPERVISOR; trim + upper-case SKU; product + balance 0 in one transaction).
- **Tests:** `AC-02.1`–`AC-02.5`; `BR-01` table-driven valid/invalid SKUs; `BR-02` case-insensitive duplicate; `BR-03` field limits; `FR-12` balance row exists with 0; pagination meta correct.
- **Verify:** `cd backend && npm test -- products`
- **Done when:** responses match openapi `Product` exactly; all listed tests pass.

### [ ] T008 Receiving document state machine (pure)
- **Refs:** prd §9, BR-11; technical-spec §7
- **Depends:** T002
- **Work:** `document-state.ts` with `assertCan(action, status)` and `nextStatus(action, status)`, including `CLOSE_SHORT`, `REVERSE` and `CLOSED_SHORT`.
- **Tests:** unit test for every action × status combination (7 × 6 = 42 cases) asserting allowed/denied and the correct error code (`INVALID_DOCUMENT_STATUS` for RECEIVE/REVERSE/EDIT_ITEMS, `INVALID_STATUS_TRANSITION` for OPEN/COMPLETE/CLOSE_SHORT/CANCEL).
- **Verify:** `cd backend && npm test -- document-state`
- **Done when:** 42/42 cases pass; no DB access in this file.

### [ ] T009 Create, list and view receiving documents
- **Refs:** prd FR-20–FR-23, BR-04–BR-06, BR-16, US-03 (AC-03.1–AC-03.3); technical-spec §4.4, §6.1 (Create document); openapi `/receiving-documents`, `/receiving-documents/{documentId}`
- **Depends:** T007, T008
- **Work:** create (SUPERVISOR) with optional lines in one transaction, number from sequence `RCV-YYYY-NNNNNN`; list with status filter, search, pagination, summary totals; detail with lines (remaining, isFullyReceived), `allItemsReceived`, receipts oldest first, actor refs.
- **Tests:** `AC-03.1`, `AC-03.2` (duplicate product in create payload), `AC-03.3`, `BR-04` field validation, `BR-16` unknown productId → 422, document numbers are unique and sequential, list filters by status and search, operator → 403 on create.
- **Verify:** `cd backend && npm test -- receiving-documents`
- **Done when:** response shapes match openapi `ReceivingDocumentSummary` / `ReceivingDocumentDetail`.

### [ ] T010 Edit lines on draft documents
- **Refs:** prd FR-24–FR-26, BR-05, BR-06, BR-10, BR-16; technical-spec §6.1 (Add/change/remove line); openapi `/receiving-documents/{documentId}/items*`
- **Depends:** T009
- **Work:** add, change expected quantity, remove; each locks the document and requires `DRAFT`; item must belong to the document (else 404).
- **Tests:** happy path for each; `BR-06` duplicate → 409; `BR-10` each operation on OPEN/IN_PROGRESS/COMPLETED/CANCELLED → 409 `INVALID_DOCUMENT_STATUS`; item of another document → 404; operator → 403.
- **Verify:** `cd backend && npm test -- receiving-items`
- **Done when:** all pass.

### [ ] T011 Open, complete and cancel
- **Refs:** prd FR-27–FR-29, BR-11, BR-15, US-03 (AC-03.4, AC-03.5), US-05; technical-spec §6.1, §7
- **Depends:** T010
- **Work:** three POST action endpoints, each one transaction with document `FOR UPDATE`, using `document-state.ts`; record timestamps and actor; complete returns `details.incompleteItemIds` on 422.
- **Tests:** `AC-03.4`, `AC-03.5`, `AC-05.1`–`AC-05.6`; operator → 403 on all three. (AC-05.1/5.2 need receipts: write them as `it.todo` now and implement in T012.)
- **Verify:** `cd backend && npm test -- transitions`
- **Done when:** all non-todo tests pass.

### [ ] T012 Record receipt — the critical transaction
- **Refs:** prd FR-30–FR-32, FR-34, BR-07, BR-08, BR-13, US-04 (AC-04.1–AC-04.5); technical-spec §6 (all steps), §5 (last paragraph); openapi `…/receipts`, schemas `RecordReceiptRequest`, `ReceiptResult`
- **Depends:** T011
- **Work:** `ReceiptsService.recordReceipt` implementing steps 4–14 of spec §6 exactly (idempotency lookup may be a stub that always misses; T013 completes it). Row locks via `tx.$queryRaw` in order document → item; balance updated with `UPDATE … RETURNING`. Controller validates the `Idempotency-Key` header format. Return 201 `ReceiptResult`. Finish the `it.todo` tests from T011.
- **Tests:** `AC-04.1`, `AC-04.2`, `AC-04.3` (assert line, receipts count, balance and ledger all unchanged), `AC-04.4` (0, -1, 1.5, "ten", missing body), `AC-04.5` (DRAFT, COMPLETED, CANCELLED), missing/invalid header → 400, item of another document → 404, `AC-05.1`, `AC-05.2`. Call `assertInventoryConsistent()` at the end of every test.
- **Verify:** `cd backend && npm test -- receipts`
- **Done when:** all pass; no other code path writes stock (`grep -rn "inventoryBalance\|inventoryTransaction" src` shows writes only in receipts.service.ts and products.service.ts).

### [ ] T013 Idempotency
- **Refs:** prd FR-33, BR-09, AC-04.6, AC-04.7; technical-spec §6 steps 5 and 15
- **Depends:** T012
- **Work:** full step 5 (replay → 200 + `Idempotent-Replayed: true`, mismatch → 409) and step 15 (unique-violation race → rollback and re-check once).
- **Tests:** `AC-04.6` (same request twice → same receipt id, state unchanged), `AC-04.7` (same key, other quantity; same key, other line), two identical requests sent concurrently with `Promise.all` → exactly one receipt, one 201 and one 200.
- **Verify:** `cd backend && npm test -- idempotency`
- **Done when:** all pass and `assertInventoryConsistent()` holds.

### [ ] T014 Concurrency and reconciliation evidence
- **Refs:** prd BR-12, BR-14, AC-04.8, AC-06.3; technical-spec §6 (Concurrency reasoning)
- **Depends:** T013
- **Work:** tests only, plus fixes if they fail.
- **Tests:** `AC-04.8` (5 × 4 units against remaining 10, parallel, distinct keys → exactly 2 succeed); 20 parallel receipts of 1 across two documents that each have a line for the same product → totals exact; receipt racing with `cancel` on an OPEN document → either the receipt wins (cancel gets 409) or cancel wins (receipt gets 409), never both; receipt racing with `complete` → consistent; final `assertInventoryConsistent()`. Run the concurrency file 10 times in a loop to detect flakiness.
- **Verify:** `cd backend && for i in $(seq 10); do npm test -- concurrency || exit 1; done`
- **Done when:** 10/10 runs green. Output is pasted into `docs/testing.md` as evidence.

### [ ] T015 Inventory and transaction history
- **Refs:** prd FR-40, FR-41, US-06; technical-spec §5; openapi `/inventory`, `/inventory/transactions`
- **Depends:** T012
- **Work:** balances list (sorted by SKU, search, pagination); transactions list (newest first by id, filters productId / receivingDocumentId / from / to, joins product, document number and user; bigint id as string).
- **Tests:** `AC-06.1`, `AC-06.2`, each filter, invalid UUID/date → 400.
- **Verify:** `cd backend && npm test -- inventory`
- **Done when:** shapes match openapi `InventoryBalance` / `InventoryTransaction`.

### [ ] T026 Close short
- **Refs:** prd FR-35, BR-11, BR-17, US-08, §9; technical-spec §3.2 (`receiving_documents`), §6.1 (Close short), §7, §8; openapi `/receiving-documents/{documentId}/close-short`, `ReasonRequest`, `ReceivingDocumentDetail`
- **Depends:** T012
- **Work:** `POST …/close-short` (SUPERVISOR), one transaction with document `FOR UPDATE`, using `document-state.ts`; records `closed_short_at`, `closed_short_by_id`, `close_short_reason`. No stock writes. Detail response includes `closedShortAt`, `closedShortBy`, `closeShortReason`.
- **Tests:** `AC-08.1` (assert balance and ledger unchanged, then receipt → 409), `AC-08.2`, `AC-08.3` (each of the 5 statuses), `AC-08.4`, operator → 403. `assertInventoryConsistent()` at the end of every test.
- **Verify:** `cd backend && npm test -- close-short`
- **Done when:** all pass.

### [ ] T027 Receipt reversal
- **Refs:** prd FR-36, FR-37, BR-12, BR-13, BR-17–BR-19, US-09; technical-spec §3.2 (`receipt_reversals`, `inventory_transactions`), §4.3, §6.2 (all steps); openapi `…/receipts/{receiptId}/reverse`, `Receipt`, `ReceiptReversal`, `InventoryTransaction`
- **Depends:** T014, T015
- **Work:** `ReceiptsService.reverseReceipt` implementing spec §6.2 steps 4–15 in order, locks via `tx.$queryRaw` document → item, balance via `UPDATE … RETURNING`. Map P2002 on `receipt_reversals_receipt_id_key` → 409. Detail response shows `reversal` per receipt; transactions list returns `RECEIPT_REVERSAL` rows with `receiptReversalId`.
- **Tests:** `AC-09.1` (status back to OPEN, original receipt and RECEIPT row unchanged), `AC-09.2`, `AC-09.3`, `AC-09.4` (sequential and two parallel reversals → exactly one 200), `AC-09.5`, `AC-09.6`; reversal racing with a receipt on the same line → totals consistent; `AC-05.4` cancel works after AC-09.1. `assertInventoryConsistent()` at the end of every test.
- **Verify:** `cd backend && npm test -- reversal`
- **Done when:** all pass; stock writes still only in `receipts.service.ts` and `products.service.ts`.

### [ ] T016 API documentation and contract check
- **Refs:** technical-spec §0 (API docs), §4; openapi (all)
- **Depends:** T005–T015, T026, T027
- **Work:** serve `docs/openapi.yaml` with Swagger UI at `/api/docs` (copy the file into the image at build time). Run the `spec-reviewer` subagent over the whole backend and fix every GAP.
- **Tests:** a test that loads `openapi.yaml` and asserts every path+method in it is routed in the app (no 404 for any documented route) and no undocumented route exists.
- **Verify:** `cd backend && npm test` (full suite) `&& npm run lint && npm run build`
- **Done when:** full suite green; reviewer table has no GAP rows; findings and fixes logged in `docs/ai-workflow.md`.

🔍 **Gate 2:** read `receipts.service.ts` line by line yourself. You must be able to explain every statement in the technical review.

## Phase 3 — Frontend

### [ ] T017 Frontend foundation and login
- **Refs:** prd FR-01, FR-04, FR-05, US-01, NFR-06; technical-spec §1.1, §1.3, §4.2
- **Depends:** T006
- **Work:** Mantine + TanStack Query + React Router setup; `api/client.ts` (relative `/api/v1`, bearer token, parses error envelope into an `ApiError` with code/message/details, on 401 clears token and redirects to `/login`); `AuthProvider`, `ProtectedRoute`, `useCurrentUser`, `can(role, action)` helper mirroring spec §8; app shell with nav (Receiving, Products, Inventory, Transactions), user name, role badge, logout; `LoginPage`; `ErrorAlert` component showing `message`.
- **Tests:** Vitest: `can()` table matches spec §8; client maps an error envelope to `ApiError`; LoginPage shows the API message on 401.
- **Verify:** `cd frontend && npm test && npm run build`; manual: log in as both seeded users with backend running.
- **Done when:** login/logout works; protected pages redirect when logged out.

### [ ] T018 Products page
- **Refs:** prd FR-10, FR-11, US-02 (AC-02.5); openapi `/products`
- **Depends:** T017, T007
- **Work:** table (SKU, name, unit, on-hand, created), search box (debounced), pagination, "New product" modal for supervisors only, field errors from `details.fields` shown under inputs, 409 shown as a form error.
- **Tests:** Vitest: create button hidden for operator; field error rendering from a mocked `VALIDATION_ERROR`.
- **Verify:** `cd frontend && npm test && npm run build`; manual check against AC-02.1–AC-02.5.
- **Done when:** a supervisor can create a product and see it listed.

### [ ] T019 Receiving document list and create page
- **Refs:** prd FR-20–FR-22, US-03; openapi `/receiving-documents`
- **Depends:** T017, T009
- **Work:** list with status filter (tabs or select), search, pagination, `StatusBadge`, progress (`received / expected`); create page (supervisor only) with header fields and a dynamic line editor (product picker with search, expected quantity); prevents picking the same product twice; on success navigates to the detail page.
- **Tests:** Vitest: line editor blocks duplicate product; quantity input rejects 0 and decimals.
- **Verify:** `cd frontend && npm test && npm run build`; manual create flow.
- **Done when:** a supervisor can create a draft with lines.

### [ ] T020 Receiving document detail and status actions
- **Refs:** prd FR-23–FR-29, FR-34, US-03, US-05, §9; technical-spec §7, §8
- **Depends:** T019, T011
- **Work:** header with status, timestamps and actors; lines table (SKU, name, unit, expected, received, remaining, fully-received check); receipts history table; in DRAFT (supervisor): add line, edit qty, remove line, "Open for receiving"; in IN_PROGRESS with `allItemsReceived` (supervisor): "Complete" with confirmation and the hint "All items received — ready to complete"; in DRAFT/OPEN (supervisor): "Cancel" with a required reason dialog. Buttons are shown only when both role and status allow the action (use `document-state` rules mirrored on the frontend).
- **Tests:** Vitest: action visibility per role × status.
- **Verify:** `cd frontend && npm test && npm run build`; manual run of US-03 and US-05.
- **Done when:** every transition can be performed from the UI and API errors are displayed.

### [ ] T021 Receive form
- **Refs:** prd FR-30–FR-33, AC-04.9, NFR-06; technical-spec §6 (Frontend side)
- **Depends:** T020, T013
- **Work:** per line that is not fully received (document OPEN/IN_PROGRESS, operator or supervisor): integer input limited to 1..remaining and a "Receive" button; idempotency key from `crypto.randomUUID()` created when the form mounts, kept for retries, renewed after success or when the quantity changes; button disabled while pending; on success clear the field, show a notification and invalidate the document, inventory and transactions queries; on 422 show the remaining quantity from `details`.
- **Tests:** Vitest: the same key is sent on retry after a network error; a new key after success; max is enforced.
- **Verify:** `cd frontend && npm test && npm run build`; manual: partial then full receipt; double-click does not double-receive.
- **Done when:** AC-04.9 holds.

### [ ] T028 Close short and reversal in the UI
- **Refs:** prd FR-23, FR-35, FR-36, US-08, US-09; technical-spec §7, §8; openapi `…/close-short`, `…/receipts/{receiptId}/reverse`
- **Depends:** T021, T026, T027
- **Work:** on the detail page (supervisor only): in IN_PROGRESS with at least one line short, "Close short" with a required reason dialog (reuse the cancel dialog); in IN_PROGRESS, a "Reverse" action per receipt that is not reversed, with a required reason dialog. Reversed receipts show as struck through with reason, time and user. On a CLOSED_SHORT document the remaining column is labelled "Short" and the close-short reason is shown. On success invalidate the document, inventory and transactions queries.
- **Tests:** Vitest: close-short and reverse visibility per role × status; reverse hidden on an already reversed receipt.
- **Verify:** `cd frontend && npm test && npm run build`; manual run of US-08 and US-09.
- **Done when:** both actions work from the UI and API errors are displayed.

### [ ] T022 Inventory and transaction history pages
- **Refs:** prd FR-40, FR-41, US-06; openapi `/inventory*`
- **Depends:** T017, T015
- **Work:** inventory table (SKU, name, unit, on-hand, updated) with search and pagination, each row links to transactions filtered by that product; transactions table (date/time in local zone, SKU, name, type, change, balance after, document number linking to the document, user) with product and date filters.
- **Tests:** Vitest: date formatting uses local time; filter params map to the query string.
- **Verify:** `cd frontend && npm test && npm run build`; manual check of AC-06.1, AC-06.2.
- **Done when:** both pages work against real data.

🔍 **Gate 3:** click through the full workflow as both roles.

## Phase 4 — Delivery

### [ ] T023 Containerization and clean-start deployment
- **Refs:** technical-spec §10, §11; prd NFR-05, NFR-08
- **Depends:** T016, T022
- **Work:** `backend/Dockerfile` (multi-stage, non-root, entrypoint runs `prisma migrate deploy`, seed when `SEED_ON_START=true`, then the app); `frontend/Dockerfile` + `nginx.conf` (static files, SPA fallback, proxy `/api/` and `/health` to `api:3000`); full `docker-compose.yml` with `db`, `api`, `web`, healthchecks and `depends_on: condition: service_healthy`; `web` published, `db` on 127.0.0.1 only.
- **Tests:** none new.
- **Verify:** `docker compose down -v && docker compose up --build -d && docker compose ps` (all healthy) `&& curl -fsS localhost:8080/health && docker compose restart api && curl -fsS localhost:8080/health` (migrations re-run safely).
- **Done when:** clean start works with only `.env` created from `.env.example`; output saved for testing.md.

### [ ] T024 End-to-end test
- **Refs:** technical-spec §9; prd US-03, US-04, US-05, US-06
- **Depends:** T023
- **Work:** Playwright at repo root (`e2e/`), one spec: supervisor creates product and a document with 2 lines → opens it → logs out → operator receives a partial and then the rest → supervisor completes → inventory shows the totals and transactions show 3 rows. Also: operator does not see the "New product" button.
- **Verify:** `npm run test:e2e` against the running stack; save the HTML report screenshot.
- **Done when:** green twice in a row on a fresh `docker compose down -v` stack.

### [ ] T025 Final documentation and review
- **Refs:** assessment brief §3.E, §5; all docs
- **Depends:** T024
- **Work:** `README.md` (stack, prerequisites, quick start from clean machine, demo users and where their passwords come from, running unit/integration/E2E tests, env vars table, project structure, links to every doc, known limitations); finish `docs/testing.md` evidence sections with real output; finish `docs/ai-workflow.md` (prompt log, mistakes caught, decisions); run `spec-reviewer` one last time over the whole repo.
- **Verify:** follow the README on a clean clone in a new folder; every command works as written.
- **Done when:** every deliverable in the brief's §5 list exists and is linked from the README.
