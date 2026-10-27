# Warehouse Receiving System

A small web application that replaces a receiving spreadsheet. Supervisors register products and inbound receiving documents (supplier, expected lines). Operators record what actually arrives, in partial or full receipts. Stock is updated in the same database transaction as each receipt, and every change is kept in an append-only inventory ledger.

The rules that protect stock are enforced by the API and backed by database constraints, not only by the UI:
- no over-receipt (BR-07)
- a document completes only when every line is fully received (BR-11)
- a retried request never receives twice (idempotency key, BR-09)
- concurrent receipts cannot exceed the expected quantity (row locks, BR-14)

It was built spec-first with an AI coding agent. The specs in [`docs/`](docs) are the source of truth.

## Stack

| Layer | Choice |
|---|---|
| Backend | Node.js 22, TypeScript, NestJS 11, Prisma 6, PostgreSQL 16, JWT (HS256) + bcrypt |
| Frontend | React 19, Vite, Mantine 8, TanStack Query 5, React Router 7 |
| API contract | Hand-written OpenAPI 3.1 ([`docs/openapi.yaml`](docs/openapi.yaml)), served with Swagger UI at `/api/docs` |
| Tests | Jest + Supertest against real PostgreSQL, Vitest + Testing Library, Playwright |
| Delivery | Docker, Docker Compose v2, nginx |

Full rationale: [technical-spec.md §0](docs/technical-spec.md#0-technology-stack).

## Prerequisites

- **To run the app:** Docker with Compose v2 (Docker Desktop, or Docker Engine plus the compose plugin). Free host ports `8080` (web) and `5432` (database, bound to `127.0.0.1` only).
- **To run the tests or develop:** Node.js 22 and npm, plus the database container above.

## Quick start (clean machine)

```bash
git clone <this repository> logistics-wrs
cd logistics-wrs
cp .env.example .env        # then replace the placeholders, see below
docker compose up --build -d
docker compose ps           # db, api and web should all show (healthy)
curl localhost:8080/health  # {"status":"ok","database":"up"}
```

Open <http://localhost:8080> and log in.

On every start the API container runs `prisma migrate deploy`, which only applies pending migrations and is safe to repeat. When `SEED_ON_START=true` it then seeds the demo users and products; the seed uses upserts, so it never duplicates rows or resets stock. Only after that does the app start. `web` waits until `api` is healthy, and `api` waits until `db` is healthy.

> **Secrets.** `.env.example` holds placeholders only, and it is the only env file committed. The stack starts with them unchanged, but `JWT_SECRET` is then a publicly known value. Before running anywhere other than your own machine, replace `JWT_SECRET` with 32+ random characters (for example `openssl rand -base64 48`) and set your own `POSTGRES_PASSWORD` and seed passwords. Keep `POSTGRES_PASSWORD` URL-safe (letters, digits, `-`, `_`), because Compose puts it into the API's database URL.

Stop with `docker compose down`. `docker compose down -v` also deletes the database volume.

### Demo users

`prisma/seed.ts` creates two users (and five demo products) when `SEED_ON_START=true`:

| Username | Role | Password comes from |
|---|---|---|
| `supervisor` | SUPERVISOR: products, documents, lines, open, complete, close short, cancel, reverse receipts, and receiving | `SEED_SUPERVISOR_PASSWORD` in `.env` |
| `operator` | OPERATOR: record receipts; read everything | `SEED_OPERATOR_PASSWORD` in `.env` |

Passwords are hashed with bcrypt when a user is first created. Changing the variable later does not change an existing user's password (it only applies after `docker compose down -v`).

### Useful URLs

| URL | What |
|---|---|
| <http://localhost:8080> | Web app |
| <http://localhost:8080/health> | Health check (API + database) |
| <http://localhost:8080/api/docs> | Swagger UI for the REST API (`/api/v1/...`) |

## Running the tests

```bash
docker compose up -d db                          # the tests need the database container

# Backend: unit + integration tests against the real wrs_test database (created by docker/db-init)
cd backend
npm ci
npx prisma generate                              # the Prisma client is generated, not installed
cp .env.test.example .env.test                   # same credentials as .env; tests refuse any DB but wrs_test
npm test                                         # or: npm test -- -t "BR-07"   /   npm test -- --coverage
cd ..

# Frontend unit tests (no database needed)
cd frontend && npm ci && npm test && cd ..

# End-to-end (Playwright) against the full running stack
docker compose up --build -d
npm ci
npx playwright install chromium
npm run test:e2e                                 # reads demo passwords and WEB_PORT from .env
```

If you changed the database credentials in `.env`, make the same change to `DATABASE_URL` in `backend/.env.test`.

The test catalogue (every BR/AC mapped to a test) and the evidence (coverage, idempotency, concurrency stress, clean start, E2E) are in [docs/testing.md](docs/testing.md).

## Local development (without the app containers)

```bash
docker compose up -d db
cp .env backend/.env                             # Prisma and the API read backend/.env; DB host is 127.0.0.1
cd backend && npm ci && npx prisma migrate dev && npx prisma db seed && npm run start:dev   # API on :3000
# in a second terminal, from the repo root:
cd frontend && npm ci && npm run dev             # Vite on :5173; proxies /api and /health to :3000
```

## Configuration

All configuration comes from environment variables. Compose reads them from `.env`.

| Variable | Used by | Example | Required |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | db; Compose also builds the API's database URL from them (host `db`) | `wrs` / `change-me` / `wrs` | yes |
| `DATABASE_URL` | host-side backend, Prisma CLI and tests (host `127.0.0.1`) | `postgresql://wrs:change-me@127.0.0.1:5432/wrs?schema=public` | yes, for local dev |
| `JWT_SECRET` | api; the API refuses to start if it is missing or shorter than 32 characters | 32+ random characters | yes |
| `JWT_EXPIRES_IN` | api: token lifetime, with a unit | `8h` | no (default `8h`) |
| `PORT` | host-side api (inside Compose it is fixed to `3000`) | `3000` | no |
| `SEED_ON_START` | api container: seed demo data after migrating | `true` | no (default `false`) |
| `SEED_SUPERVISOR_PASSWORD` / `SEED_OPERATOR_PASSWORD` | seed, E2E tests | — | when seeding |
| `WEB_PORT` | web: host port | `8080` | no (default `8080`) |

## Project structure

```
backend/                NestJS API
  prisma/               schema.prisma, migrations/ (hand-added CHECKs, sequence, lower() indexes), seed.ts
  src/modules/          auth, products, receiving (documents, receipts, state machine), inventory, health
  src/common/           auth guards, error envelope + Prisma error mapping, validation, pagination
  test/                 integration tests (Supertest + real PostgreSQL) and helpers
  Dockerfile            deps → build → runtime (non-root); migrate, seed, start
frontend/               React app (pages/, components/, api/, auth/), Dockerfile, nginx.conf
e2e/                    Playwright end-to-end spec (playwright.config.ts at the root)
docker/db-init/         creates the wrs_test database on first start
docker-compose.yml      db, api, web with healthchecks
docs/                   specifications, diagrams, testing and AI-workflow documents
CLAUDE.md               instructions the AI coding agent works under
.claude/                agent skills (implement-task) and the spec-reviewer subagent
```

## Documentation

| Document | Contents |
|---|---|
| [docs/prd.md](docs/prd.md) | Product requirements: problem, roles, FR/NFR, user stories and acceptance criteria, business rules, scope, assumptions, open questions |
| [docs/technical-spec.md](docs/technical-spec.md) | Architecture, ERD, DDL and migrations, API summary, data flow, receipt transaction, state machine, authorization, testing, configuration, deployment |
| [docs/erd.mmd](docs/erd.mmd) | Entity relationship diagram (Mermaid) |
| [docs/openapi.yaml](docs/openapi.yaml) | REST API contract (OpenAPI 3.1) |
| [docs/data-flow.mmd](docs/data-flow.mmd) | Data flow diagram |
| [docs/receipt-sequence.mmd](docs/receipt-sequence.mmd) | Sequence diagram of recording a receipt |
| [docs/document-states.mmd](docs/document-states.mmd) | Receiving document state diagram |
| [docs/tasks.md](docs/tasks.md) | Ordered implementation tasks the agent worked through |
| [docs/testing.md](docs/testing.md) | Test strategy, catalogue, evidence and known limitations |
| [docs/ai-workflow.md](docs/ai-workflow.md) | How the AI agent was directed: workflow, prompts, review findings, mistakes caught, decisions made during implementation |
| [CLAUDE.md](CLAUDE.md) | Project instructions given to the agent |
| [.claude/](.claude) | Agent task skill (`implement-task`) and the `spec-reviewer` subagent used at review gates |
| [backend/prisma/migrations/](backend/prisma/migrations) | Database migrations (Prisma SQL, with hand-added CHECK constraints, sequence and indexes) |
| [docker-compose.yml](docker-compose.yml), [backend/Dockerfile](backend/Dockerfile), [frontend/Dockerfile](frontend/Dockerfile), [frontend/nginx.conf](frontend/nginx.conf) | Docker configuration |

## Known limitations

These are the main ones. The full list, with impact and possible improvements, is in [testing.md §5](docs/testing.md#5-known-limitations-and-unresolved-issues). Out-of-scope features are listed in [prd.md §5.2](docs/prd.md#52-out-of-scope-explicitly-not-to-be-built).

- No correction after a document is `COMPLETED` or `CLOSED_SHORT`. A reversal is whole-receipt only, and only while the document is `IN_PROGRESS`.
- Single warehouse: no locations, lots, expiry dates or temperature records.
- Access token only, with no refresh or revocation. Users exist only through the seed; there is no user management.
- `JWT_EXPIRES_IN` is not validated at startup. A value without a unit (for example `3600`) is read as milliseconds.
