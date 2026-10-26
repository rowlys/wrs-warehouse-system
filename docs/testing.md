# Testing and Quality Assurance

| Field | Value |
|---|---|
| Strategy defined in | [technical-spec.md §9](technical-spec.md#9-testing-strategy) |
| Status | Strategy and catalogue written before implementation. Evidence sections are filled in during tasks T014, T023–T025. |

## 1. Approach

- **Test-first for business rules.** Each task in [tasks.md](tasks.md) lists its tests; the agent writes them before the implementation and must show them failing first.
- **Real database.** Integration tests run the real NestJS app against a real PostgreSQL database (`wrs_test`). Locks, transactions and CHECK constraints cannot be proven with mocks.
- **Traceable.** Every test name starts with the requirement it proves (`BR-07 …`, `AC-04.3 …`), so `npm test -- -t "BR-07"` finds the evidence for any rule.
- **Global invariant check.** After every receiving test, `assertInventoryConsistent()` verifies across the whole database that:
  - each product's on-hand quantity equals the sum of its inventory transactions and is never negative (BR-12);
  - each line's received quantity equals the sum of its receipts and stays between 0 and expected (BR-13).

## 2. How to run

| What | Command | Needs |
|---|---|---|
| Backend unit + integration | `cd backend && npm test` | `docker compose up -d db` and `backend/.env.test` (copy from `.env.test.example`) |
| One rule | `cd backend && npm test -- -t "BR-07"` | same |
| Concurrency stress (10 runs) | `cd backend && for i in $(seq 10); do npm test -- concurrency \|\| exit 1; done` | same |
| Coverage | `cd backend && npm test -- --coverage` | same |
| Frontend unit | `cd frontend && npm test` | — |
| End-to-end | `npm run test:e2e` (repo root) | full stack running: `docker compose up --build -d` |

## 3. Test catalogue

Levels: **U** unit, **I** integration/API (Supertest + PostgreSQL), **E** end-to-end (Playwright), **M** manual.

### 3.1 Critical business rules

| Test ID | Requirement | Level | Scenario | Expected |
|---|---|---|---|---|
| T-RCV-01 | AC-04.1, FR-31 | I | Receive 40 of 100 on an OPEN document | received 40, remaining 60, on-hand +40, 1 ledger row (+40, balance after 40), status IN_PROGRESS |
| T-RCV-02 | AC-04.2, FR-32 | I | Then receive the remaining 60 | received 100, fully received, on-hand 100 |
| T-RCV-03 | AC-04.3, BR-07 | I | Receive 61 with 60 remaining | 422 `QUANTITY_EXCEEDS_REMAINING`, `details.remainingQuantity = 60`; line, receipts, balance, ledger unchanged |
| T-RCV-04 | AC-04.4, BR-07 | I | Quantity 0, -1, 1.5, "ten", missing | 400 `VALIDATION_ERROR`; nothing changed |
| T-RCV-05 | AC-04.5, BR-08 | I | Receive on DRAFT, COMPLETED, CANCELLED | 409 `INVALID_DOCUMENT_STATUS`; nothing changed |
| T-RCV-06 | BR-09 | I | Missing or malformed `Idempotency-Key` | 400 `VALIDATION_ERROR` |
| T-RCV-07 | — | I | Item ID that belongs to another document | 404 `NOT_FOUND` |
| T-IDM-01 | AC-04.6, BR-09 | I | Same request + key sent twice in sequence | 201 then 200 with same receipt id and `Idempotent-Replayed: true`; stock counted once |
| T-IDM-02 | AC-04.7, BR-09 | I | Same key, different quantity / different line | 409 `IDEMPOTENCY_KEY_REUSED`; nothing changed |
| T-IDM-03 | BR-09, spec §6 step 15 | I | Same request + key sent twice **in parallel** | exactly one receipt; one 201 and one 200 |
| T-CON-01 | AC-04.8, BR-14 | I | 5 parallel receipts of 4 against remaining 10 | exactly 2 × 201, 3 × 422; received 8; on-hand +8 |
| T-CON-02 | BR-12, BR-14 | I | 20 parallel receipts of 1 across 2 documents for the same product | on-hand +20 exactly; ledger has 20 rows; balances reconcile |
| T-CON-03 | BR-14 | I | Receipt and cancel in parallel on an OPEN document | exactly one succeeds; never "cancelled with stock received" |
| T-CON-04 | BR-14 | I | Last receipt and complete in parallel | complete succeeds only if it ran after the receipt; never "completed while not fully received" |
| T-INV-01 | AC-06.1 | I | Receipts 40 + 60 | inventory shows 100 |
| T-INV-02 | AC-06.2 | I | Transactions filtered by product | 2 rows, newest first, correct balance after, document number and user |
| T-INV-03 | AC-06.3, BR-12 | I | Reconciliation after every receiving test | Σ ledger = on-hand for every product |
| T-DB-01 | BR-13, NFR-01 | I | Direct SQL update setting received > expected | rejected by `ri_received_range_chk` |
| T-DB-02 | BR-12, NFR-01 | I | Direct SQL update setting a negative balance | rejected by `ib_non_negative_chk` |

### 3.2 Documents, lines and status transitions

| Test ID | Requirement | Level | Scenario | Expected |
|---|---|---|---|---|
| T-STM-01 | BR-11, spec §7 | U | All 25 action × status combinations | allowed/denied and error code exactly per spec §7 |
| T-DOC-01 | AC-03.1, FR-22 | I | Create with 2 lines | DRAFT, number `RCV-YYYY-NNNNNN`, lines received 0 |
| T-DOC-02 | AC-03.2, BR-06 | I | Same product twice (on create and on add) | 409 `DUPLICATE_PRODUCT_IN_DOCUMENT` |
| T-DOC-03 | AC-03.3, BR-05 | I | Expected 0, -5, 2.5, 1,000,001 | 400 |
| T-DOC-04 | BR-04 | I | Missing supplier name, over-long fields | 400 with field names |
| T-DOC-05 | BR-16 | I | Unknown productId | 422 `PRODUCT_NOT_FOUND` |
| T-DOC-06 | BR-10 | I | Add/change/remove line on each non-DRAFT status | 409 `INVALID_DOCUMENT_STATUS` |
| T-DOC-07 | AC-03.4 | I | Open with no lines | 422 `DOCUMENT_HAS_NO_ITEMS` |
| T-DOC-08 | AC-03.5 | I | Open with lines | OPEN, opened_at/by set |
| T-DOC-09 | AC-05.1 | I | Complete when all received | COMPLETED; further receipts → 409 |
| T-DOC-10 | AC-05.2 | I | Complete with a line outstanding | 422 `ITEMS_NOT_FULLY_RECEIVED` with `incompleteItemIds` |
| T-DOC-11 | AC-05.3 | I | Complete DRAFT / OPEN | 409 `INVALID_STATUS_TRANSITION` |
| T-DOC-12 | AC-05.4, AC-05.5, BR-15 | I | Cancel DRAFT / OPEN; cancel IN_PROGRESS / COMPLETED | CANCELLED with reason; 409 |
| T-DOC-13 | AC-05.6, BR-15 | I | Cancel without reason | 400 |
| T-DOC-14 | FR-20 | I | List filtered by status, search by supplier and number, pagination meta | correct subsets and meta |

### 3.3 Products, auth and API behaviour

| Test ID | Requirement | Level | Scenario | Expected |
|---|---|---|---|---|
| T-PRD-01 | AC-02.1, FR-12 | I | Create `frz-chk-001` | stored as `FRZ-CHK-001`; balance row 0 |
| T-PRD-02 | AC-02.2, BR-02 | I | Create `frz-chk-001` again | 409 `DUPLICATE_SKU` |
| T-PRD-03 | AC-02.3, BR-01 | I | SKUs `AB`, `-ABC`, `AB C`, 51 chars | 400 naming `sku` |
| T-PRD-04 | AC-02.4 | I | Search `chk` | only matches, any case |
| T-AUT-01 | AC-01.1 | I | Valid login | token + user |
| T-AUT-02 | AC-01.2 | I | Wrong user / wrong password | identical 401 `INVALID_CREDENTIALS` bodies |
| T-AUT-03 | AC-01.3, FR-02 | I | No / malformed / expired token on a protected route | 401 `UNAUTHENTICATED` |
| T-AUT-04 | AC-01.4, AC-02.5, FR-03 | I | Operator calls each supervisor-only endpoint (create product, create document, line edits, open, complete, cancel) | 403 `FORBIDDEN`; nothing changed |
| T-API-01 | NFR-07 | I | Every path in `openapi.yaml` is routed; no undocumented routes | pass |
| T-API-02 | spec §4.2 | U | Exception filter maps AppError, validation, P2002, unknown errors | envelope shape and codes per spec §4.3 |
| T-HLT-01 | AC-07.1, AC-07.2 | I | DB up / DB query throws | 200 / 503 |

### 3.4 Frontend and end-to-end

| Test ID | Requirement | Level | Scenario | Expected |
|---|---|---|---|---|
| T-FE-01 | FR-04, spec §8 | U | `can(role, action)` table | matches the authorization matrix |
| T-FE-02 | AC-04.9, spec §6 | U | Receive form retry after network error | same idempotency key resent; new key after success |
| T-FE-03 | FR-04 | U | Document actions per role × status | only allowed buttons rendered |
| T-E2E-01 | US-03 → US-06 | E | Supervisor creates product + document, opens; operator receives partial then rest; supervisor completes; inventory and history correct | pass |
| T-E2E-02 | AC-02.5 | E | Operator does not see "New product" | pass |
| T-MAN-01 | NFR-06 | M | API error messages readable in UI; layout usable at 768 px | checklist below |

## 4. Evidence

> Filled in with real command output during implementation. Paste output, not summaries.

### 4.1 Full backend suite
```
(paste `npm test -- --coverage` summary here — T016)
```

### 4.2 Inventory stays correct after receiving (T-RCV-01, T-RCV-02, T-INV-01–03)
```
(paste test output — T012/T015)
```

### 4.3 Duplicate and invalid operations do not corrupt stock (T-RCV-03–05, T-IDM-01–03)
```
(paste test output — T013)
```

### 4.4 Concurrency stress, 10 consecutive runs (T-CON-01–04)
```
(paste loop output — T014)
```

### 4.5 Clean-start deployment and health check (T023)
```
(paste `docker compose ps` and `curl localhost:8080/health` output)
```

### 4.6 End-to-end run (T024)
(screenshot or Playwright report link)

### 4.7 Manual checklist (T-MAN-01)
- [ ] Operator sees no create/open/complete/cancel buttons
- [ ] Over-receipt attempt shows "only N remaining" message
- [ ] Double-clicking "Receive" records one receipt
- [ ] Expired session returns to login
- [ ] Pages usable at 768 px width

## 5. Known limitations and unresolved issues

| # | Limitation | Impact | Possible improvement |
|---|---|---|---|
| L-1 | Short deliveries cannot be closed (PRD Q-01) | A document stays IN_PROGRESS forever if the supplier never sends the rest | "Close short" supervisor action with reason and a `COMPLETED_SHORT` status |
| L-2 | No receipt correction (PRD Q-02) | A counting mistake cannot be fixed in the system | Reversal transaction type with supervisor approval; never edit history |
| L-3 | No lot / expiry / temperature capture (PRD Q-06) | Not sufficient for real cold-chain traceability | Add lot, production and expiry dates per receipt; FEFO reporting |
| L-4 | Single warehouse, no locations | Cannot say where stock is stored | Locations and putaway tasks |
| L-5 | Access token only, no refresh or revocation | Session ends after 8 h; a leaked token is valid until expiry | Refresh tokens with rotation, server-side revocation list |
| L-6 | Idempotency keys kept forever | `receipts.idempotency_key` grows with receipts (acceptable at this scale) | Scope keys per user and expire old ones |
| L-7 | Users only via seed | No onboarding of new staff | User management for supervisors/admins |
| L-8 | (add anything found during implementation) | | |
