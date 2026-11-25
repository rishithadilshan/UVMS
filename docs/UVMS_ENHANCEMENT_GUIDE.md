# UVMS enhancement — delivery guide (v3.0)

Stack (unchanged): React 18 + Vite · Express · PostgreSQL 16 · JWT. Time zone: **Asia/Colombo** (naive local timestamps stored in `timestamp` columns; the pool forces `SET TIME ZONE 'Asia/Colombo'` and returns DATE/TIMESTAMP as plain strings so no JS time-zone shift can occur).

## 1. Existing architecture (what was found)
Monolithic `backend/server.js` (Express, ~110 dense lines), PostgreSQL schema with fixed `time_slots`, `bookings.time_slot_id NOT NULL`, statuses `ACTIVE/CANCELLED`, GiST exclusion constraints for venue/lecturer overlap, roles `ADMIN/LECTURER/STUDENT/LAB_ASSISTANT`, legacy `booking_requests` and lecturer `exchange_requests`, notifications table, React pages for Allocate / TimeSlots / Schedule / Requests / Exchanges. Public registration created auto-approved students.

## 2. Design decisions (please read)
* **Preserved:** stack, DB, auth model, bcrypt, rate-limit, helmet/CORS, Docker setup, `LAB_ASSISTANT` role + lab status page, users/venues/courses/departments/time-slot tables, all legacy slot/request/exchange endpoints (moved to `routes/legacy.js`).
* **Lab Assistant:** the spec's role list has 4 roles but several sections mention Lab Assistants. The role is kept (admin-created) with the same booking and venue-change rights as Lecturer/Instructor.
* **Venue status model:** `venues.status` is the base state; date-range closures live in `venue_maintenance`. The effective status is computed on the fly, so a period "ends" by itself and a venue "can be available outside its maintenance period".
* **"Competing requests" (priority page):** pending bookings already reserve the venue, so two requests can never overlap. Real competition therefore appears as *venue-change requests* (requester category priority vs. the existing booking's). The admin records a ruling (audited, both users notified); it never overrides a confirmed booking.
* **Student-owned bookings:** students cannot approve venue changes, so a change request that targets a student's booking is decided by an Admin.
* **Privacy vs. the "name and e-mail" requirement:** *Already booked* cards show booker name and e-mail to staff/admin; students see the name only (set `EXPOSE_BOOKER_EMAIL_TO_STUDENTS=true` to show e-mail). Purpose/title of other users' bookings is never exposed; the calendar shows "Booked" only.
* **Student cancellation:** cancelling a *pending* request is immediate; cancelling a *confirmed* booking creates a cancellation request (reason mandatory) for the Admin.
* **Real-time:** Server-Sent Events (`GET /api/notifications/stream`) + 45 s polling fallback instead of Socket.IO (no new dependency). nginx config includes an unbuffered location for it.
* **Email:** registration approve/reject emails go through `lib/mailer.js` (nodemailer if installed and `SMTP_HOST` set; otherwise recorded in `email_log`).

## 3. Files
**New backend:** `app.js`, `db/migrations/002_uvms_enhancements.sql`, `lib/{core,auth,time,availability,bookings,maintenance,reminders,waitlist,recommend,scheduler,notify,realtime,mailer,xlsx}.js`, `routes/{auth,users,venues,maintenance,bookings,venueChanges,categories,notifications,calendar,waitlist,reports,admin,legacy}.js`, `tests/{unit,integration}.test.js`.
**Modified backend:** `server.js` (now only boots app + scheduler), `db/pool.js`, `scripts/migrate.js` (runs numbered migrations), `scripts/seed-dev.js`, `.env.example`, `package.json`.
**New frontend:** `lib/format.js`, `context/{ThemeContext,NotificationsContext}.jsx`, `components/{AppShell,NotificationBell,Modal,FacilitySelect,StatusBadge,Pagination,BookingModal,BookingDetails,ChangeRequestModal}.jsx`, pages `Dashboard, FindVenue, MyBookings, VenueChanges, CalendarPage, Notifications, CheckIn` and admin pages `Overview, Registrations, Bookings, StudentRequests, Venues, Maintenance, Priority, Users, Reports, Settings`.
**Rewritten frontend:** `styles.css` (central light/dark tokens), `App.jsx`, `main.jsx`, `index.html`, `AuthContext`, `Login`, `Register`, `LabStatus`.
**Removed from the UI (backend retained):** Allocate Lecture, Time Slot, My Requests, Schedule, My Schedule, Exchanges, Lab Schedule, Admin Requests, ScheduleGrid. Slot allocation is still available as `POST /api/bookings/allocate`; admins create flexible bookings for any user in *Booking Management*.

## 4. Database changes (`002_uvms_enhancements.sql`)
users: `status` PENDING/APPROVED/REJECTED (authoritative; legacy `approved` is derived by trigger), `registration_number` (unique, case-insensitive), `rejection_reason`, `reviewed_by/at`, `approval_notice_pending`, role `INSTRUCTOR`.
venues: statuses `AVAILABLE/UNDER_MAINTENANCE/TEMPORARILY_CLOSED/UNAVAILABLE`, `active`/`deleted_at` (soft delete).
bookings: flexible `starts_at/ends_at`, `time_slot_id` nullable, statuses `PENDING/CONFIRMED/REJECTED/CANCELLED/EXPIRED`, `owner_id, category_id, purpose, justification, required_facilities, expires_at, decided_*, rejection_reason, cancel_*, checkin_token`. **Exclusion constraint now covers PENDING + CONFIRMED** (`newStart < existingEnd AND newEnd > existingStart`).
New tables: `facilities, booking_categories, booking_series, booking_history, booking_approvals, venue_maintenance, maintenance_affected_bookings, venue_change_requests, booking_modification_requests, booking_reminders, check_ins, waitlist_entries, app_settings, email_log`. `notifications` gained `entity_type, entity_id, dedupe_key` (unique) — duplicate-proof. `ACTIVE` bookings are migrated to `CONFIRMED`; `available/maintenance/disabled` venues to the new names.

## 5. Install, migrate, run
```bash
cd backend && npm install && cp .env.example .env   # set DATABASE_URL, JWT_SECRET (>=32 chars), CLIENT_URL
npm run migrate                                     # applies 001 + 002 (idempotent, transactional)
npm run admin:create                                # secure admin creation (interactive)
npm run dev                                         # API + scheduler on :5050
cd ../frontend && npm install && npm run dev        # http://localhost:5173
# Docker: docker compose up --build  (migrate runs automatically)
```
Optional: `npm i nodemailer` in backend for real SMTP e-mail. **Back up the database before migrating an existing one.**
Tests: `npm test` (unit, no DB) · `npm run test:integration` (needs a migrated PostgreSQL).

## 6. Workflows
* **Registration:** form (Lecturer/Instructor/Student; student number shown only for students; password 8–12) → `PENDING`, admin notified → admin approves (in-app + e-mail, first login shows a welcome message) or rejects with reason (in-app + e-mail). Login is refused for PENDING/REJECTED with distinct messages. Admin accounts exist only via `admin:create` or User Management.
* **Booking:** Lecturer/Instructor/Lab Assistant → validated in one transaction (venue row locked, per-occurrence checks, DB constraint as last guard) → `CONFIRMED`, owner + admin notified, reminder created. Student → `PENDING`, venue reserved, admin notified; approve → `CONFIRMED`; reject (reason) → `REJECTED` + released; no response within `pending_expiry_hours` (default 24) → `EXPIRED`, student + admin notified. Recurring (weekly / bi-weekly) is validated per occurrence and the result lists successes and conflicts.
* **Venue change:** *Already booked* card → request (venue, date, times, participants, category, purpose, reason, message) → owner notified → owner **rejects** with message, or **agrees** by choosing an alternative venue/time; the alternative is validated against the *original* booking's capacity, facilities and availability (and must not clash with the new request) → on *Confirm relocation* one transaction moves the original booking and creates the requester's booking (student requesters → `PENDING`), both with history; both users notified. If nothing valid is confirmed nothing changes.
* **Priority:** categories/levels in DB (1 = highest, admin-configurable, can be deactivated); admin compares competing change requests and records a ruling (audited, notifies both).
* **Maintenance:** admin creates a date-range closure; overlapping bookings are listed first (409 + list) and only after confirmation saved — they are **not cancelled**, owners/admins are notified, history is written; admin re-arranges via *Re-schedule / move*. Restore reopens and triggers the waitlist.
* **Notifications:** persisted per user; bell with unread count, mark read / all, history page, click-through links, live SSE push.
* **Reminders:** scheduler (every 60 s, backend only) sends *"Your Venue Booking Is Tomorrow!"* ≈24 h before start (Asia/Colombo); bookings made <24 h ahead get an immediate short-notice reminder; reschedule recalculates; cancel/reject/expire cancels the pending reminder; `booking_reminders` + a unique `dedupe_key` prevent duplicates, `FOR UPDATE SKIP LOCKED` makes it multi-instance-safe, start-up back-fill recovers after downtime. Admin → Settings → *Reminder delivery* shows all records.

## 7. API reference (all under `/api`, JWT bearer; ✱ = admin only)
Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`.
Users ✱: `GET /users/registrations`, `POST /users/registrations/:id/approve|reject`, `GET|POST /users`, `PUT|DELETE /users/:id`.
Venues: `GET /venues`, `GET /venues/meta`, `GET /venues/search?date&startTime&endTime&participants&facilities&building&type`, `GET /venues/:id`, ✱ `POST /venues`, `PUT|DELETE /venues/:id`, `PATCH /venues/:id/reactivate`, `GET /venues/:id/history`, `POST|PATCH /venues/facilities`, `PATCH /venues/:id/status` (admin / managing lab assistant).
Maintenance ✱: `GET /maintenance`, `GET /maintenance/preview`, `POST /maintenance` (`force`), `POST /maintenance/:id/restore`, `POST /maintenance/venue/:id/restore`.
Bookings: `GET /bookings` (own; `scope=all` admin; filters `status,time,venueId,categoryId,from,to,q,page,pageSize`), `POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel`, `POST /bookings/:id/modify`, `POST /bookings/:id/check-in`, `POST /bookings/check-in/token`, ✱ `POST /bookings/:id/decision`, ✱ `PATCH /bookings/:id/admin-update`, ✱ `POST /bookings/allocate` (legacy slot allocation).
Modification/cancellation requests: `GET /modification-requests`, ✱ `POST /modification-requests/:id/decision`.
Venue changes: `GET /venue-changes?box=incoming|outgoing|all`, `POST /venue-changes`, `GET /venue-changes/:id/alternatives`, `POST /venue-changes/:id/validate`, `POST /venue-changes/:id/respond`, `POST /venue-changes/:id/cancel`.
Priority: `GET /categories`, ✱ `POST|PUT /categories(/:id)`, ✱ `GET /priority/conflicts`, ✱ `POST /priority/conflicts/:id/decision`.
Notifications: `GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/stream` (SSE), `PATCH /notifications/read-all`, `PATCH /notifications/:id/read`.
Calendar: `GET /calendar?from&to&venueId&building&status&categoryId` (≤62 days; details filtered by permission).
Waitlist: `GET|POST /waitlist`, `DELETE /waitlist/:id`.
Reports ✱: `GET /reports/summary?period=daily|weekly|monthly|custom`, `GET /reports/export?format=xlsx|csv`.
Admin ✱: `GET /admin/overview|audit|reminders|emails|settings`, `PUT /admin/settings`.
Legacy (unchanged behaviour): `/timeslots`, `/requests`, `/exchanges`, `/courses`, `/departments`, `/bookings/schedule|my-schedule|availability`.

## 8. Testing status — read honestly
| Check | Result |
|---|---|
| Unit tests (`npm test`): window validation, overlap rule, Colombo reminder maths, recurrence, partial availability, facility matching, ranking, XLSX/CSV | **8/8 pass** (run in this environment) |
| XLSX export opened with an independent reader (openpyxl) | **pass** |
| Express app boots, routes mount, auth/validation guards respond (401 / 400 / 404) | **pass** (no DB) |
| All backend files `node --check`; all 40+ frontend files parsed with Babel, every relative/named import resolves | **pass** |
| **SQL, transactions, constraints, scheduler against PostgreSQL** | **NOT executed** — no PostgreSQL in the build sandbox. `tests/integration.test.js` (≈45 assertions covering registration, RBAC, overlap, pending reservation, expiry, maintenance, reminders, venue change relocation, priority, waitlist, reports) is written but **has not been run**. |
| **Frontend production build / browser UI checks (light/dark, mobile, calendar)** | **NOT executed** — the uploaded `node_modules` contain Windows-only binaries, so Vite could not run here. |

Run `npm run migrate && npm run test:integration` and `npm run build` on your machine first; expect to fix a few small defects (they are most likely in SQL I could not execute). Please send me any failures.

## 9. Known limitations
* QR **image** not rendered (no QR library offline): the check-in link/token and `POST /bookings/check-in/token` work; add `qrcode.react` to draw it from the link shown in booking details.
* PDF export = browser *Print / Save as PDF* of the report page; Excel/CSV are server generated.
* Maintenance affects existing bookings only by notification + admin re-arrangement (by design — nothing is auto-cancelled).
* Venue-change requests cover one conflicting booking at a time.
* Overnight bookings (past midnight) are not supported; a booking is within one day.
* `sessionStorage` bearer-token caveat from the original README still applies.
* No Socket.IO; SSE + polling are used.
