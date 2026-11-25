# UVMS Initial Testing Plan

## Objective

Establish that UVMS implements its discovered workflows correctly, with highest priority on venue and lecturer conflict prevention under concurrent use.

## Phase 1 completion

Completed:

- Repository structure inspected.
- Frontend, backend, database, authentication, routes, migrations, and deployment reviewed.
- Existing unit, integration, and Playwright test suites inventoried.
- Four-role permission matrix derived from server authorization.
- The existing extra LAB_ASSISTANT role was identified and excluded from the requested four-role test scope.
- Booking statuses were derived from implementation rather than status names alone.
- Unit test baseline and frontend build baseline executed.

Blocked before live testing:

- Docker Desktop is not available.
- API and frontend are not listening on the configured local ports.
- The isolated QA PostgreSQL port is reachable at TCP level but direct PG connection is currently refused.
- QA account, venue, and database isolation remain unverified.

No migration, seed, create, update, delete, truncate, or application start command was run in this phase.

## Critical test strategy

1. Start only an isolated PostgreSQL database dedicated to QA.
2. Apply migrations through `npm run db:migrate`.
3. Verify active schema, constraints, and migration versions with read-only SQL.
4. Seed only dedicated approved QA accounts and a dedicated venue/category.
5. Start backend and frontend against the isolated database.
6. Execute unit tests.
7. Execute integration tests with real PostgreSQL.
8. Execute concurrent identical and overlapping booking requests.
9. Verify database rows directly for zero overlapping PENDING/CONFIRMED allocations.
10. Execute Playwright role and workflow tests.
11. Execute remaining functional and non-functional phases.

## Immediate exit criteria for Phase 1

- The QA database is confirmed as isolated and migrations are current.
- QA accounts are active, approved, and use only the four requested roles.
- A dedicated QA venue and category exist.
- Frontend and backend are confirmed reachable and healthy.
- Database access is read-only or application access is appropriately scoped for the test runner.

## Proposed test priorities

| Priority | Area |
|---|---|
| P0 | Concurrent venue conflicts, overlap calculations, database exclusion constraints |
| P0 | Authentication, authorization, role escalation, logout/session expiry |
| P0 | Pending/confirmed/rejected/cancelled/expired status integrity |
| P1 | Booking modification, cancellation, recurrence, approval |
| P1 | Venue CRUD, maintenance, capacity and facilities |
| P1 | Timetable/calendar privacy and direct API access |
| P2 | User and registration lifecycle |
| P2 | Change requests, waitlist, reminders and notifications |
| P2 | Reports, settings, check-in and legacy workflows |

## Tools selected

- Node `node:test` for unit and PostgreSQL integration tests.
- PostgreSQL as the real database for schema and concurrency verification.
- Playwright for browser and API-assisted E2E testing.
- Existing Playwright HTML reports, screenshots, traces and videos.
- Optional load tools only after baseline execution and if an isolated environment is available.
