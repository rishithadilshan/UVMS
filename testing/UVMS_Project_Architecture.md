# UVMS Phase 1 Project Architecture

## Inspection status

Phase 1 was inspected statically and with available local commands. No application source, database, environment, or test fixture was modified.

## Confirmed architecture

| Area | Implementation |
|---|---|
| Frontend | React 18.3.1, React Router 7.18.4, Vite 7.3.6 |
| Backend | Node.js 20+, Express 4.21.2 |
| Database | PostgreSQL 16+, node-postgres 8.13.1 |
| Authentication | JWT bearer tokens, bcrypt password hashing |
| Authorization | Server-side role reload from PostgreSQL on every authenticated request |
| Deployment | Docker Compose; separate static frontend and API deployment possible |
| Browser automation | Playwright 1.56.1 in `qa-playwright` |
| Time zone | Asia/Colombo for naive wall-clock booking timestamps |

## Runtime layout

- Frontend source: `frontend/src`
- API entry point: `backend/server.js`
- Express configuration and routes: `backend/app.js`
- Route modules: `backend/routes`
- Database pool: `backend/db/pool.js`
- Schema baseline: `backend/db/migrations/schema.sql`
- Enhancement migration: `backend/db/migrations/002_uvms_enhancements.sql`
- Performance migration: `backend/db/migrations/003_performance_indexes.sql`
- Backend unit tests: `backend/tests/unit.test.js`
- Backend integration tests: `backend/tests/integration.test.js`
- Playwright suite: `qa-playwright/tests`

## Database integrity

The implementation uses PostgreSQL `btree_gist` exclusion constraints on `bookings`:

- Venue: PENDING and CONFIRMED bookings overlap by `[starts_at, ends_at)` for the same venue.
- Lecturer: PENDING and CONFIRMED bookings overlap for the same lecturer.
- Booking creation locks the venue row and uses savepoints, then relies on the database constraint as the final concurrency guard.
- Rejected, cancelled, and expired bookings do not satisfy the active exclusion constraint.
- The database trigger derives slot-based booking intervals from editable time slots.

This is an application-level and database-level design appropriate for concurrent booking safety. It still requires live PostgreSQL execution to prove the constraint behavior and HTTP/database outcomes.

## Authentication and authorization

- Bearer JWTs are kept in browser `sessionStorage`.
- `/api/auth/me` reloads the database record.
- Authentication rejects inactive or unapproved accounts.
- JWT role claims are not trusted for authorization.
- Public registration is restricted to LECTURER, INSTRUCTOR, and STUDENT.
- ADMIN accounts are created through an administrator or the administrative CLI.

## Initial execution findings

- Backend unit tests: 8 passed.
- Frontend production build: passed.
- Docker Desktop: unavailable from the current environment.
- Frontend port 5173: not listening.
- Backend port 5050: not listening.
- Configured QA PostgreSQL port 5433: listening at TCP level, but a direct PG connection was refused.
- QA database isolation could not be verified; live tests are blocked.
