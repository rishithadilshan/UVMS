# UVMS performance optimization report

**Measurement status (read this first).** The optimization was done in an environment with no PostgreSQL server, no network and a
Windows-built `node_modules` (no Linux rollup binary). Therefore **no query timings, API timings, EXPLAIN plans or bundle sizes were
measured**, and none are claimed. What *was* verified: every backend file passes `node --check`, the 8 unit tests pass, the app boots,
the new middleware/cache were exercised with a stub, and every frontend file parses (Babel). Scripts to produce the real before/after numbers
are included (section F). Counts of requests/queries below are exact (read from the code), not timings.

## A. Performance analysis (from reading the code)

| # | Finding | Where |
|---|---|---|
| 1 | Admin overview ran **9 sequential COUNT queries** + 1 feed query, and the page called it **twice** (sidebar badges in `AppShell` and the `Overview` page) | `routes/admin.js`, `AppShell.jsx`, `Overview.jsx` |
| 2 | Lecturer/Instructor/Student dashboard = **3 HTTP requests**, each re-authenticating (1 user lookup) and 2 of them also running a separate COUNT → 9 queries | `Dashboard.jsx` |
| 3 | `starts_at::date …` filters (reports, bookings list, "bookings today") cannot use an index on `starts_at`; no plain `starts_at` index existed | reports / bookings / admin |
| 4 | Reports ran 7 independent queries one after another | `routes/reports.js` |
| 5 | Booking detail, calendar, notifications list ran independent queries sequentially (notifications: 2 COUNTs + list) | `bookings.js`, `calendar.js`, `notifications.js` |
| 6 | Recurring booking (≤60 occurrences) re-read the `reminder_lead_hours` setting for every occurrence; waitlist scheduler (every 60 s) re-loaded the same venue per entry; `notifyAdmins` = 1 SELECT + 1 INSERT per admin | `lib/bookings.js`, `waitlist.js`, `notify.js` |
| 7 | Admin Bookings re-fetched modification requests on every filter keystroke; Venues re-fetched lookups on every search keystroke; no debounce | admin pages |
| 8 | Every page was in the initial JS bundle (no code splitting); nginx served uncompressed assets with no cache headers | `App.jsx`, `nginx.conf` |
| 9 | Notification polling (45 s) ran even while the live SSE stream worked and while the tab was hidden | `NotificationsContext.jsx` |
| 10 | **Risk, not changed:** the global limiter allows only 100 `/api` requests per IP per 15 min. Behind one campus/NAT IP, several users' dashboards + polling can hit HTTP 429. Now configurable (`GENERAL_RATE_LIMIT`), default unchanged. |  `middleware/rateLimiter.js` |

Slowest endpoints/queries: **not measured** (no database). Use `scripts/perf-explain.js` and the new `[slow-request]` / `[slow-query]` logs.

## B. Database indexing report

Existing schema inspected: 26 tables (`schema_migrations`, `departments`, `users`, `venues`, `venue_managers`, `time_slots`, `courses`, `bookings`,
`booking_requests`, `exchange_requests`, `notifications`, `audit_logs`, `facilities`, `booking_categories`, `booking_series`, `booking_history`,
`booking_approvals`, `venue_maintenance`, `maintenance_affected_bookings`, `venue_change_requests`, `booking_modification_requests`,
`booking_reminders`, `check_ins`, `waitlist_entries`, `app_settings`, `email_log`). Existing indexes (kept, none changed): all PK/UNIQUE indexes,
`bookings_date_idx`, `bookings_lecturer_idx`, `bookings_owner_idx(owner_id,starts_at)`, `bookings_status_idx(status,starts_at)`,
`bookings_venue_time_idx(venue_id,starts_at,ends_at)`, `bookings_pending_expiry_idx`, `bookings_series_idx`, the two GiST exclusion constraints,
`users_status_idx`, `venues_search_idx`, `booking_history_booking_idx`, `venue_maintenance_venue_idx`, `vcr_owner/requester/target_idx`,
`bmr_status_idx`, `bmr_one_pending_per_booking`, `notifications_user_idx(user_id,read,created_at DESC)`, `notifications_dedupe_uq`,
`booking_reminders_due_idx`, `waitlist_venue_idx`, `waitlist_unique_active`, `audit_logs_entity_idx`, `audit_logs_created_idx`.

**New (migration `003_performance_indexes.sql`, additive only):**

| Index | Columns | Why / queries that benefit | Overhead |
|---|---|---|---|
| `bookings_starts_at_idx` | `bookings(starts_at)` | admin list `ORDER BY starts_at`, calendar window, report ranges, "bookings today" (no existing index leads with `starts_at`) | 1 index on the largest table; small write cost |
| `bookings_category_idx` | `bookings(category_id)` partial `IS NOT NULL` | per-category count in `GET /api/categories` (called from 4 pages), category filters; FK had no index | small |
| `notifications_user_created_idx` | `notifications(user_id, created_at DESC)` | feed query polled by every user (existing index can't serve `ORDER BY created_at` without `read`) | notifications are insert-heavy: +1 index per insert |
| `vcr_pending_start_idx` | `venue_change_requests(requested_starts_at)` partial `status='PENDING'` | admin pending counter (polled) and scheduler's per-minute expiry UPDATE; holds only pending rows | negligible |
| `venue_maintenance_open_idx` | `venue_maintenance(venue_id, starts_at)` partial `restored_at IS NULL` | venue effective-status sub-select, availability checks, "unavailable venues" counter | negligible |

Storage overhead: **not measured** (`scripts/perf-explain.js` prints index sizes). For large production tables build them first with
`db/ops/003_performance_indexes_concurrently.sql` (CONCURRENTLY, outside a transaction); the migration's `IF NOT EXISTS` then does nothing.

**Deliberately not created:** `users(role)` / `users(department_id)` (small table, `users_status_idx` serves the hot query); `audit_logs(actor_id)`,
`bookings(created_by/decided_by/cancelled_by)`, `booking_approvals(booking_id)`, `maintenance_affected_bookings(booking_id)` (FK-only columns never filtered on; deletes are soft);
legacy `booking_requests` / `exchange_requests` / `time_slots` (no longer used by the UI; tiny); `text` search (`LIKE '%x%'`) trigram indexes (needs `pg_trgm`, only worth it at much larger volume);
GiST rewrite of the conflict query (`tsrange && tsrange` could use the exclusion index, but I could not test the plan — recommended follow-up). `bookings_date_idx` looks redundant with the new
index for most queries but legacy endpoints use it: review `pg_stat_user_indexes.idx_scan` before dropping anything.

## C. Query optimization

| Before | After | Equivalent? |
|---|---|---|
| 9 COUNT queries sequentially + feed | 1 query of scalar sub-selects, run in parallel with the feed | same counters; "today" = `starts_at >= day_start AND < day_start + 1 day` (was `starts_at::date = today`) |
| reports: `starts_at::date BETWEEN a AND b` (7 sequential queries) | `starts_at >= a AND starts_at < b+1`, queries via `Promise.all`; per-venue join restricted to `CONFIRMED` rows (the only rows aggregated) | same rows |
| bookings list `from`/`to`: `starts_at::date >=/<=` + COUNT then page | range on `starts_at`, COUNT and page concurrently | same rows |
| notifications: 2 COUNTs + page | 1 `count(*) FILTER` + page concurrently | same totals |
| booking detail: 4 sequential follow-ups | `Promise.all` (permission check still happens first) | same |
| calendar: events → maintenance → venues | all three concurrently | same |
| `notifyAdmins`: SELECT admins + INSERT per admin | one `INSERT … SELECT … RETURNING` (live push per row, after commit) | same recipients |
| waitlist loop: venue loaded per entry | once per venue per run | same (availability still checked per entry) |
| recurring booking: setting read per occurrence | read once | same |

EXPLAIN plans / timings before and after: **not measured** — run `node scripts/perf-explain.js` before and after `npm run db:migrate`.

## D. Backend

* New `GET /api/dashboard/summary` (roles Lecturer/Instructor/Student/Lab assistant — same audience as the existing page): same three datasets, scoped to the signed-in user, 3 queries instead of 9. Old endpoints unchanged.
* Overview: described above. No endpoint removed.
* **Monitoring** (`lib/perf.js`): per request total / DB (includes pool wait) / backend time + query count; only requests over `SLOW_REQUEST_MS` (500) and queries over `SLOW_QUERY_MS` (250) are logged; the log uses the route *pattern* only (no URL query string, headers, tokens, bodies or SQL parameters); SSE stream excluded. Optional `Server-Timing` + `X-DB-Queries` headers with `PERF_SERVER_TIMING=true`.
* **Pool:** the app already used one shared `pg.Pool` and every `connect()` is released in `finally` (reviewed all call sites — no leak found). Added `statement_timeout` (30 s) and `idle_in_transaction_session_timeout` (60 s) as safety nets, `DB_POOL_MAX` passed through compose; migrations run with no statement timeout. Pool size left at 10.
* **Caching:** only `GET /api/venues/meta` (dropdown lookups), 60 s TTL, in-process, cleared by every venue/facility write. Nothing about availability, conflicts, bookings, roles or permissions is cached, and booking validation still always reads the database. Redis was **not** introduced (single backend instance, nothing worth sharing).
* Booking integrity untouched: `checkVenue`, venue row locks, transactions and the GiST exclusion constraints are unchanged.

## E. Frontend

* All pages except Login/Register/NotFound are `React.lazy`; one `<Suspense>` in `AppShell` keeps sidebar/top bar visible with a skeleton fallback; routes unchanged.
* Vendor chunks (react, router, axios) for long-term caching; nginx now gzips text assets, caches `/assets/*` for a year (`immutable`) and sends `no-cache` for `index.html`.
* Dashboard: one request, skeleton cards/table, error state (previously `–`/"Loading…" and silent failures).
* Admin Overview reuses the shell's single request (was 2), skeletons while loading; admin counter polling and notification polling pause in hidden tabs, and notification polling is a fallback only while SSE is down.
* Admin Bookings/Venues/Users: debounced search (300 ms); secondary lists are no longer re-fetched on every keystroke.
* No `React.memo`/`useMemo` were added: nothing here was shown to re-render expensively and I could not profile. Layout, colours, typography, routes unchanged (only new skeleton CSS classes appended).

## F. Performance comparison

| Metric | Before | After |
|---|---|---|
| Initial application load | not measured | not measured |
| Admin / Lecturer / Instructor / Student dashboard load | not measured | not measured |
| Average API response time | not measured | not measured |
| Slowest database query | not measured | not measured |
| **API requests to open Admin overview** (counted from code) | 2 | 1 |
| **API requests to open a non-admin dashboard** | 3 | 1 |
| **DB queries for the non-admin dashboard** (incl. auth lookups) | 9 | 3 |
| **DB queries for the admin overview** (incl. auth) | 2 × (1 auth + 10) = 22 | 1 auth + 2 = 3 |
| Initial JS bundle | not measured (build could not run here) | not measured |

To get the real numbers: `node scripts/perf-explain.js` (plans/timings/index sizes), `scripts/perf-bench.js` (per-role dashboard latency, old vs new request pattern, same build),
`npm run build` in `frontend` (bundle sizes), and the `[slow-*]` logs / `Server-Timing` header.

## G. Verification

Files changed: see `uvms-performance.patch` (37 files). Migration: `backend/db/migrations/003_performance_indexes.sql`.
Apply: `docker compose up -d --build` (the `migrate` service applies 003 automatically) or `cd backend && npm run db:migrate`.
Run: `docker compose up -d --build` → http://localhost:8080. Dev: `npm run dev` in `backend/` and `frontend/`.
Done here: `node --check` on all backend files, `npm test` (8/8), app boot + 401/404 smoke test, Babel parse of all frontend files.
**Not done here (please run):** `npm run test:integration` (needs a database), `npm run build` in `frontend`, manual click-through of all four roles, benchmarks.
Note: the repository's CI is GitHub Actions (`.github/workflows/ci.yml`); no Jenkinsfile was in the zip, so nothing Jenkins-specific was touched (no new build steps are required).
Remaining bottlenecks / next steps: auth lookup on every request (kept for security; could be cached for a few seconds only if measured as hot), `audit_logs` COUNT(*) on the audit page grows with the table,
`LIKE '%…%'` searches, conflict-query GiST rewrite, `/venues` effective-status sub-selects at large venue counts, `status` filter on `/venues` done in JavaScript, `bookingCount` on every `/categories` call.
