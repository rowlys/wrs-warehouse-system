# Product Requirements Document — Warehouse Receiving System (WRS)

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Approved for implementation |
| Last updated | 2026-10-26 |
| Related docs | [technical-spec.md](technical-spec.md), [openapi.yaml](openapi.yaml), [erd.mmd](erd.mmd), [tasks.md](tasks.md) |

> **How to read this document.** Every requirement has a stable ID. Functional requirements are `FR-xx`, business rules are `BR-xx`, non-functional requirements are `NFR-xx`, assumptions are `A-xx`, and open questions are `Q-xx`. The technical spec, task list and tests refer to these IDs. If a behaviour is not described here, it is **not** in scope; an implementer must not invent it.

---

## 1. Problem statement

The warehouse records incoming inventory in spreadsheets. This causes three recurring problems:

1. **Over-receiving and double counting.** Nothing stops an operator from entering more than was ordered, or entering the same delivery twice.
2. **No reliable stock figure.** Stock is calculated by hand from several sheets, so "how many do we have?" has no single trustworthy answer.
3. **No audit trail.** When a number is wrong, nobody can tell who changed it, when, or why.

## 2. Business objectives

| ID | Objective | How we know it is met |
|---|---|---|
| OBJ-1 | One system of record for inbound deliveries | Every delivery is a receiving document with a unique number and status |
| OBJ-2 | Stock can never be inflated by receiving errors | Over-receipt and duplicate submissions are rejected by the server (BR-07, BR-09) |
| OBJ-3 | Stock figures are always explainable | On-hand quantity always equals the sum of the product's inventory transactions (BR-12) |
| OBJ-4 | Clear separation between planning and execution | Supervisors define what is expected; operators record what arrived (Section 3) |

## 3. User roles and responsibilities

| Role | Who | Responsibilities in the system |
|---|---|---|
| **Warehouse Supervisor** (`SUPERVISOR`) | Shift lead / inbound planner | Maintains the product catalogue. Creates receiving documents from supplier delivery notices, defines expected quantities, releases (opens) documents for receiving, completes or cancels documents. May also record receipts. |
| **Warehouse Operator** (`OPERATOR`) | Dock / receiving staff | Views open receiving documents, physically counts goods and records received quantities. Views inventory and transaction history. |

**Design decision (A-03):** Operators cannot create documents or change expected quantities. The person who defines what *should* arrive is not the person who records what *did* arrive. This is a standard segregation-of-duties control and directly supports OBJ-2 and OBJ-4.

There is no user-management UI. Users are created by a seed script (A-08).

## 4. Glossary

| Term | Meaning |
|---|---|
| Product | An item the warehouse stocks, identified by a unique SKU |
| SKU | Stock Keeping Unit code, e.g. `FRZ-CHK-001` |
| Receiving document | The record of one inbound delivery from one supplier. Has a number like `RCV-2026-000001` |
| Receiving item (line) | One product on a receiving document, with an expected and a received quantity |
| Receipt | One act of recording a received quantity against a line. A line can have several receipts (partial receiving) |
| Remaining quantity | `expected_quantity − received_quantity` for a line |
| On-hand quantity | Current available stock for a product |
| Inventory transaction | Immutable ledger row recording every change to on-hand quantity |

## 5. Scope

### 5.1 In scope

- Authentication with username and password; role-based authorization.
- Product listing (with search) and product creation.
- Receiving document listing (with status filter and search), creation, and detail view.
- Adding, changing and removing lines while a document is a draft.
- Opening, completing and cancelling documents according to the state machine (Section 9).
- Recording partial and full receipts per line, with protection against over-receipt, duplicates and concurrent submissions.
- Automatic inventory updates and an append-only inventory transaction history.
- Inventory listing and transaction history with filters.
- Health/readiness endpoint, containerized deployment.

### 5.2 Out of scope (explicitly not to be built)

| Feature | Reason |
|---|---|
| Supplier master data | A free-text supplier name is enough for receiving; a supplier module adds scope without testing new rules |
| Purchase orders | Receiving documents are created directly from delivery notices |
| Outbound / picking / transfers / stock adjustments | Brief covers inbound only |
| Multiple warehouses, zones, bin locations | Single warehouse assumed (A-01) |
| Lot / batch numbers, expiry dates, temperature logging | Valuable for cold storage but not in the brief; listed as future work |
| Receipt reversal / correction | Requires a reversal design and approval flow; see Q-02 |
| Short-closing a document (supplier delivered less) | See Q-01 |
| Editing or deleting products | Brief requires listing and creation only |
| Editing document header after creation | Not required; cancel and recreate while in draft |
| User management, password reset, self-registration | Users are seeded (A-08) |
| Units of measure conversion | One unit of measure per product (A-04) |
| Barcode scanning, printing, file import/export, notifications | Not required |

## 6. Functional requirements

### 6.1 Authentication and access

| ID | Requirement |
|---|---|
| FR-01 | A user logs in with username and password and receives an access token valid for 8 hours (configurable). |
| FR-02 | Every API endpoint except login and the health check requires a valid token. |
| FR-03 | The API enforces role permissions on every request according to the authorization matrix (technical spec §8), independently of the frontend. |
| FR-04 | The frontend hides or disables actions the current role is not allowed to perform. |
| FR-05 | The user can log out, which discards the token on the client. |

### 6.2 Products

| ID | Requirement |
|---|---|
| FR-10 | Any authenticated user can list products, paginated, newest first, with a text search that matches SKU or name (case-insensitive, partial). |
| FR-11 | A supervisor can create a product with SKU, name, unit of measure, and an optional description. |
| FR-12 | Creating a product also creates its inventory balance with on-hand quantity 0, in the same transaction. |
| FR-13 | Any authenticated user can view a single product by ID. |

### 6.3 Receiving documents

| ID | Requirement |
|---|---|
| FR-20 | Any authenticated user can list receiving documents, paginated, newest first, filterable by status and searchable by document number, supplier name or reference number. |
| FR-21 | A supervisor can create a receiving document with supplier name (required), supplier reference number (optional), expected arrival date (optional), notes (optional), and an optional initial list of lines. The new document has status `DRAFT`. |
| FR-22 | The system assigns a unique, human-readable document number `RCV-YYYY-NNNNNN` on creation (YYYY = creation year, NNNNNN = global sequence, zero-padded). |
| FR-23 | Any authenticated user can view a document's detail: header, status, status timestamps and actors, all lines (product SKU, name, unit, expected, received, remaining), and all receipts in chronological order. |
| FR-24 | A supervisor can add a line (product + expected quantity) to a `DRAFT` document. |
| FR-25 | A supervisor can change a line's expected quantity on a `DRAFT` document. |
| FR-26 | A supervisor can remove a line from a `DRAFT` document. |
| FR-27 | A supervisor can open a `DRAFT` document that has at least one line, making it available for receiving (status `OPEN`). |
| FR-28 | A supervisor can complete an `IN_PROGRESS` document when every line is fully received (status `COMPLETED`). |
| FR-29 | A supervisor can cancel a `DRAFT` or `OPEN` document with a mandatory reason (status `CANCELLED`). |

### 6.4 Receiving

| ID | Requirement |
|---|---|
| FR-30 | An operator or supervisor can record a receipt of a positive whole quantity against one line of an `OPEN` or `IN_PROGRESS` document. |
| FR-31 | Recording a receipt, in a single atomic operation: creates the receipt record, increases the line's received quantity, increases the product's on-hand quantity, writes an inventory transaction, and moves an `OPEN` document to `IN_PROGRESS`. Either all of these happen or none do. |
| FR-32 | A line may receive several partial receipts until its remaining quantity reaches 0. |
| FR-33 | Each receipt request carries a client-generated idempotency key. Re-sending the same request with the same key returns the original result and changes nothing. |
| FR-34 | The document detail shows, per line, whether it is fully received, and shows at document level whether all lines are fully received. |

### 6.5 Inventory

| ID | Requirement |
|---|---|
| FR-40 | Any authenticated user can list inventory: SKU, name, unit, on-hand quantity, last updated; paginated, searchable by SKU or name, sorted by SKU. |
| FR-41 | Any authenticated user can list inventory transactions, newest first, filterable by product, receiving document, and date range. Each row shows date/time, product, type, quantity change, balance after, source document number, and the user who performed it. |

### 6.6 Operations

| ID | Requirement |
|---|---|
| FR-50 | A public health endpoint reports whether the API is running and can reach the database, returning 200 when healthy and 503 otherwise. |

## 7. Business rules and validation

These rules are enforced **by the backend**. Frontend checks exist only for usability.

| ID | Rule | Rejection |
|---|---|---|
| BR-01 | SKU is required, trimmed, converted to upper case, 3–50 characters, matching `^[A-Z0-9][A-Z0-9-]*$` (letters, digits, hyphens, not starting with a hyphen). | 400 `VALIDATION_ERROR` |
| BR-02 | SKU is unique across all products (after normalization, so `abc-1` and `ABC-1` collide). SKU cannot be changed after creation. | 409 `DUPLICATE_SKU` |
| BR-03 | Product name is required, 1–200 characters after trimming. Unit of measure is required, 1–20 characters (e.g. `PCS`, `KG`, `CTN`). Description is optional, max 1000. | 400 `VALIDATION_ERROR` |
| BR-04 | Supplier name is required, 1–200 characters. Reference number optional, max 100. Notes optional, max 1000. Expected date optional, ISO date. | 400 `VALIDATION_ERROR` |
| BR-05 | Expected quantity is a whole number from 1 to 1,000,000. | 400 `VALIDATION_ERROR` |
| BR-06 | A product may appear at most once per receiving document. To expect more, change the existing line's quantity. | 409 `DUPLICATE_PRODUCT_IN_DOCUMENT` |
| BR-07 | A receipt quantity is a whole number ≥ 1 and must not exceed the line's remaining quantity at the moment the receipt is processed. Over-receipt is never allowed (A-05). | 400 `VALIDATION_ERROR` (not a positive integer); 422 `QUANTITY_EXCEEDS_REMAINING` (too large) |
| BR-08 | Receipts are accepted only when the document is `OPEN` or `IN_PROGRESS`. | 409 `INVALID_DOCUMENT_STATUS` |
| BR-09 | Every receipt request must include an `Idempotency-Key` header (8–100 characters). A key that was already used for the same line and quantity returns the original receipt with HTTP 200 and no changes. A key already used with a different line or quantity is rejected. | 400 `VALIDATION_ERROR` (missing/invalid); 409 `IDEMPOTENCY_KEY_REUSED` |
| BR-10 | Lines can be added, changed or removed only while the document is `DRAFT`. | 409 `INVALID_DOCUMENT_STATUS` |
| BR-11 | Status changes follow the state machine in Section 9 only. A document can be opened only if it has at least one line. A document can be completed only if every line has `received_quantity = expected_quantity`. | 409 `INVALID_STATUS_TRANSITION`; 422 `DOCUMENT_HAS_NO_ITEMS`; 422 `ITEMS_NOT_FULLY_RECEIVED` |
| BR-12 | For every product, on-hand quantity equals the sum of `quantity_change` over its inventory transactions, and is never negative. Inventory transactions are never updated or deleted. | Enforced by design and DB constraints |
| BR-13 | For every line, `0 ≤ received_quantity ≤ expected_quantity`, and `received_quantity` equals the sum of its receipt quantities. | Enforced by DB `CHECK` constraint and transaction logic |
| BR-14 | Two concurrent receipts against the same line must never together exceed its remaining quantity. Two concurrent status changes on the same document must never both succeed if they conflict. | Enforced by row-level locking (technical spec §6) |
| BR-15 | Cancellation requires a reason of 3–500 characters. A document that has any receipt cannot be cancelled (stock has already moved; see Q-02). | 400 `VALIDATION_ERROR`; 409 `INVALID_STATUS_TRANSITION` |
| BR-16 | Lines may only reference existing products. | 422 `PRODUCT_NOT_FOUND` |

## 8. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Data integrity | All multi-row writes run in a single database transaction. Integrity rules BR-12, BR-13 and SKU uniqueness are also enforced by database constraints, not only application code. |
| NFR-02 | Security | Passwords are stored as bcrypt hashes (cost ≥ 10). No credentials or secrets are committed; all secrets come from environment variables. Tokens are signed (HS256) with a secret from the environment. |
| NFR-03 | Auditability | Every receipt and every inventory transaction records who performed it and when (UTC). Status changes record the acting user and timestamp. |
| NFR-04 | Performance | List endpoints respond in under 500 ms at 10,000 products / 10,000 documents on a developer laptop. All lists are paginated (default 20, max 100). |
| NFR-05 | Reliability | Database schema changes are applied only through versioned migrations that run automatically and idempotently on container start. |
| NFR-06 | Usability | The main receiving flow (open document → record receipt for a line) takes no more than 3 clicks from the document list. Error messages from the API are shown to the user in plain language. Works on current Chrome, Edge and Firefox, desktop and tablet widths (≥ 768 px). |
| NFR-07 | Maintainability | The REST API is documented in `openapi.yaml` and the implementation matches it. Critical business rules have automated tests. |
| NFR-08 | Portability | The full stack starts from a clean machine with Docker and one command. |
| NFR-09 | Observability | The API logs each request (method, path, status, duration) and every unexpected error with a stack trace. Logs never include passwords or tokens. |

## 9. Receiving document lifecycle

| Status | Meaning |
|---|---|
| `DRAFT` | Being prepared by a supervisor. Lines can be edited. No receiving. |
| `OPEN` | Released to the dock. Lines are locked. Waiting for the first receipt. |
| `IN_PROGRESS` | At least one receipt has been recorded. More receipts allowed until all lines are fully received. |
| `COMPLETED` | Supervisor confirmed that everything was received. Final. |
| `CANCELLED` | Abandoned before any goods were received. Final. |

| From | To | Trigger | Who | Guard |
|---|---|---|---|---|
| — | `DRAFT` | Create document | Supervisor | Valid header (BR-04) |
| `DRAFT` | `OPEN` | Open | Supervisor | ≥ 1 line (BR-11) |
| `OPEN` | `IN_PROGRESS` | First receipt recorded (automatic) | Operator or Supervisor | Receipt valid (BR-07–BR-09) |
| `IN_PROGRESS` | `COMPLETED` | Complete | Supervisor | Every line fully received (BR-11) |
| `DRAFT` | `CANCELLED` | Cancel | Supervisor | Reason given (BR-15) |
| `OPEN` | `CANCELLED` | Cancel | Supervisor | Reason given; no receipts (BR-15) |

Any other transition is rejected with 409 `INVALID_STATUS_TRANSITION`. `COMPLETED` and `CANCELLED` are terminal.

**Design decision (A-06):** Completion is an explicit supervisor action, not automatic, even when all lines are fully received. Rationale: the brief describes completion as something that can be attempted and must be blocked; an explicit step also gives the supervisor a sign-off point before the delivery is closed. The detail view shows "All items received — ready to complete" so the supervisor knows when to act.

## 10. User stories and acceptance criteria

### US-01 Log in (FR-01–FR-05)
*As a warehouse user, I want to log in so that the system knows who I am and what I may do.*

- **AC-01.1** Given valid credentials, when I log in, then I receive a token and see the receiving document list.
- **AC-01.2** Given an invalid username or password, when I log in, then I see "Invalid username or password" and no token is issued (401 `INVALID_CREDENTIALS`; the message does not reveal which field was wrong).
- **AC-01.3** Given no token or an expired token, when I call any protected endpoint, then I get 401 `UNAUTHENTICATED` and the frontend returns me to the login page.
- **AC-01.4** Given I am an operator, when I call a supervisor-only endpoint directly, then I get 403 `FORBIDDEN` and nothing changes.

### US-02 Manage products (FR-10–FR-13, BR-01–BR-03)
*As a supervisor, I want to register products with SKU codes so that they can be put on receiving documents.*

- **AC-02.1** Given a valid SKU `frz-chk-001`, name and unit, when I create the product, then it is saved with SKU `FRZ-CHK-001` and an inventory balance of 0.
- **AC-02.2** Given a product with SKU `FRZ-CHK-001` exists, when I create another with SKU `frz-chk-001`, then I get 409 `DUPLICATE_SKU`.
- **AC-02.3** Given a SKU `AB` or `-ABC` or `AB C`, when I create the product, then I get 400 `VALIDATION_ERROR` naming the `sku` field.
- **AC-02.4** Given products exist, when I search for `chk`, then only products whose SKU or name contains `chk` (any case) are listed.
- **AC-02.5** Given I am an operator, then I can list products but I see no "New product" button, and the API rejects creation with 403.

### US-03 Create a receiving document (FR-20–FR-27, BR-04–BR-06, BR-10–BR-11)
*As a supervisor, I want to create a receiving document for an expected delivery so that the dock knows what to receive.*

- **AC-03.1** Given a supplier name and two lines, when I create the document, then it gets a number `RCV-YYYY-NNNNNN`, status `DRAFT`, and both lines with received quantity 0.
- **AC-03.2** Given a `DRAFT` document, when I add a product already on it, then I get 409 `DUPLICATE_PRODUCT_IN_DOCUMENT`.
- **AC-03.3** Given an expected quantity of 0, -5, 2.5 or 1,000,001, then I get 400 `VALIDATION_ERROR`.
- **AC-03.4** Given a `DRAFT` document with no lines, when I open it, then I get 422 `DOCUMENT_HAS_NO_ITEMS`.
- **AC-03.5** Given a `DRAFT` document with lines, when I open it, then its status becomes `OPEN`, `opened_at` and `opened_by` are recorded, and lines can no longer be edited (409 `INVALID_DOCUMENT_STATUS`).

### US-04 Record receipts (FR-30–FR-34, BR-07–BR-09, BR-13–BR-14)
*As an operator, I want to record the quantity I counted for each product so that stock is updated immediately and correctly.*

- **AC-04.1 (partial)** Given an `OPEN` document with a line expecting 100 and product on-hand 0, when I receive 40, then received = 40, remaining = 60, on-hand = 40, one inventory transaction of +40 with balance after 40 exists, and the document is `IN_PROGRESS`.
- **AC-04.2 (full)** Given that line with remaining 60, when I receive 60, then received = 100, remaining = 0, on-hand = 100, the line is marked fully received.
- **AC-04.3 (over-receipt)** Given remaining 60, when I try to receive 61, then I get 422 `QUANTITY_EXCEEDS_REMAINING` with `remainingQuantity: 60` in the details, and nothing changes in the line, receipts, balance or transactions.
- **AC-04.4 (invalid quantity)** Given a quantity of 0, -1, 1.5 or `"ten"`, then I get 400 `VALIDATION_ERROR` and nothing changes.
- **AC-04.5 (wrong status)** Given a document that is `DRAFT`, `COMPLETED` or `CANCELLED`, when I try to receive, then I get 409 `INVALID_DOCUMENT_STATUS` and nothing changes.
- **AC-04.6 (duplicate submission)** Given I submitted a receipt of 10 with key K and it succeeded, when the same request with key K is sent again, then I get HTTP 200 with the same receipt ID, and received quantity, on-hand and transaction count are unchanged.
- **AC-04.7 (key misuse)** Given key K was used for 10 units on line L, when a request uses K for 5 units or for another line, then I get 409 `IDEMPOTENCY_KEY_REUSED` and nothing changes.
- **AC-04.8 (concurrency)** Given remaining 10, when 5 requests of 4 units each arrive at the same time with different keys, then exactly 2 succeed, 3 fail with 422, received = 8, and on-hand increased by exactly 8.
- **AC-04.9 (UI)** Given I am on a document detail page, then each line that is not fully received has a quantity field and a "Receive" button; the field does not allow more than the remaining quantity; after success the line updates without a page reload and the field clears.

### US-05 Complete or cancel a document (FR-28–FR-29, BR-11, BR-15)
*As a supervisor, I want to close a delivery once everything has arrived, or cancel it if it will not arrive.*

- **AC-05.1** Given an `IN_PROGRESS` document where every line is fully received, when I complete it, then the status is `COMPLETED` with `completed_at` and `completed_by` recorded, and no further receipts are accepted.
- **AC-05.2** Given an `IN_PROGRESS` document with any line not fully received, when I complete it, then I get 422 `ITEMS_NOT_FULLY_RECEIVED` listing the incomplete line IDs, and the status is unchanged.
- **AC-05.3** Given an `OPEN` or `DRAFT` document, when I complete it, then I get 409 `INVALID_STATUS_TRANSITION`.
- **AC-05.4** Given a `DRAFT` or `OPEN` document, when I cancel it with reason "Supplier cancelled shipment", then the status is `CANCELLED` with reason, time and user recorded.
- **AC-05.5** Given an `IN_PROGRESS` or `COMPLETED` document, when I cancel it, then I get 409 `INVALID_STATUS_TRANSITION`.
- **AC-05.6** Given a cancel request with an empty reason, then I get 400 `VALIDATION_ERROR`.

### US-06 View inventory and history (FR-40–FR-41, BR-12)
*As a warehouse user, I want to see current stock and how it got there so that I can trust and explain the numbers.*

- **AC-06.1** Given receipts of 40 and 60 for product P, when I view inventory, then P shows on-hand 100.
- **AC-06.2** Given those receipts, when I view transactions filtered by P, then I see two `RECEIPT` rows (+60 with balance after 100, then +40 with balance after 40), each with the document number and user.
- **AC-06.3** For every product, on-hand equals the sum of its transaction quantity changes (verified by an automated reconciliation test).

### US-07 Check service health (FR-50)
*As an operator of the deployment, I want a health endpoint so that Docker and monitoring can tell whether the service is ready.*

- **AC-07.1** Given the database is reachable, `GET /health` returns 200 `{"status":"ok","database":"up"}`.
- **AC-07.2** Given the database is unreachable, `GET /health` returns 503 `{"status":"error","database":"down"}`.

## 11. Assumptions

The brief is intentionally incomplete. These are the decisions made to fill the gaps.

| ID | Assumption / decision | Why |
|---|---|---|
| A-01 | One warehouse, no locations or bins. | Brief mentions "a warehouse"; locations add complexity without new receiving rules. |
| A-02 | Quantities are whole numbers in the product's single unit of measure. | Counting cartons/pieces at the dock is integer; avoids decimal rounding errors. Weighed goods (KG) are out of scope (Q-04). |
| A-03 | Supervisors plan (create/open/complete/cancel, manage products); operators execute (record receipts). Supervisors can also receive. | Segregation of duties; matches typical warehouse practice. |
| A-04 | Each product has exactly one unit of measure, set at creation. | No UoM conversion in scope. |
| A-05 | Over-receipt is never allowed, not even within a tolerance. | Brief states it explicitly. Tolerance is a likely future change (Q-03). |
| A-06 | Completion is explicit by a supervisor (see Section 9). | Matches the brief's wording; adds a sign-off point. |
| A-07 | Received goods are immediately "available"; there is no quality inspection or quarantine step. | Brief says "available stock" and lists no inspection step. |
| A-08 | Users are created by a seed script; there is no user management UI. Demo passwords come from environment variables. | Brief allows "basic authentication or equivalent". |
| A-09 | A receiving document has one supplier, entered as free text. | No supplier master data in scope. |
| A-10 | All timestamps are stored in UTC and displayed in the browser's local time zone (the warehouse is in Asia/Jakarta, UTC+7). | Standard practice; avoids time zone bugs. |
| A-11 | A cancelled document stays in the system for audit; nothing is ever hard-deleted except draft lines. | Auditability (NFR-03). |
| A-12 | Expected quantities are known when the document is created (from the supplier's delivery notice). | Needed to enforce "no more than expected". |

## 12. Constraints

- Delivery within 3 calendar days at 8–12 hours of effort; correctness of the core workflow takes priority over visual polish.
- Relational database (PostgreSQL), REST API documented with OpenAPI, Docker Compose deployment.
- Implementation is done by an AI coding agent (Claude Code) working from these documents; all generated code is reviewed by the candidate.

## 13. Unresolved questions

These would be raised with the business before a real release. The current behaviour is stated for each.

| ID | Question | Current behaviour |
|---|---|---|
| Q-01 | **Short deliveries.** If a supplier delivers fewer units than expected and the rest will never come, how is the document closed? | The document cannot be completed and stays `IN_PROGRESS`. A proposed future "close short" supervisor action with a mandatory reason would end it as `COMPLETED_SHORT`. |
| Q-02 | **Corrections.** How are counting mistakes corrected after a receipt is recorded? | Not supported. A proposed future reversal would write a negative `RECEIPT_REVERSAL` transaction, never edit history. |
| Q-03 | **Over-delivery.** Should a small over-delivery tolerance (e.g. 5%) be accepted? | Rejected, per the brief. |
| Q-04 | **Weighed goods.** Do any products need decimal quantities (KG)? | Integers only. |
| Q-05 | **Unplanned deliveries.** Can operators create documents for deliveries that arrive without notice? | Only supervisors can create documents. |
| Q-06 | **Lot and expiry tracking.** For cold-storage goods, must each receipt capture lot number, production date, expiry date or temperature? | Not captured. This is the most likely real-world extension. |
| Q-07 | **Product lifecycle.** Should products be editable or deactivatable? | Not in scope; products can only be created. |
