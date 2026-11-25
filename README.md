<<<<<<< HEAD
# University Venue Management System (UVMS)

> **v3.0 enhancement:** flexible date/time booking, registration approval, student approval workflow, venue-change requests, priorities, maintenance, reminders, calendar, reports, waitlist and light/dark themes were added. See [`docs/UVMS_ENHANCEMENT_GUIDE.md`](docs/UVMS_ENHANCEMENT_GUIDE.md) for the migration steps (`npm run migrate` applies `002_uvms_enhancements.sql`), API reference, workflows and **testing status**. Where the text below describes student-only public registration or fixed time slots, the guide supersedes it.


A React + Express application for university venue allocation, timetable management, requests, lecturer exchanges, and notifications. This rebuild replaces the MongoDB/Mongoose persistence layer with PostgreSQL and adds database-enforced booking overlap protection.

## Architecture

- **Frontend:** React 18 + Vite
- **API:** Node.js 20+ + Express
- **Database:** PostgreSQL 16+
- **Authentication:** short-lived JWT bearer tokens; token kept in browser `sessionStorage`
- **Authorization:** server-side role checks; role is reloaded from the database on every authenticated request
- **Deployment:** Docker Compose for self-hosting; Render-style static frontend + web service + managed PostgreSQL can be configured separately

The backend remains a modular-monolith style API rather than introducing Spring Boot or microservices. PostgreSQL uses `btree_gist` exclusion constraints to reject overlapping venue intervals and overlapping lecturer intervals, even when requests arrive concurrently. Time-slot times remain editable database records; booking interval timestamps are recalculated when a slot changes.

## Important security decisions

1. No secrets are committed. Copy `.env.example` to `.env` and generate new values locally.
2. The API refuses to start without `DATABASE_URL`, `JWT_SECRET` (at least 32 characters), and `CLIENT_URL`.
3. CORS only allows explicitly configured origins; wildcard CORS is not enabled.
4. Public registration can create **STUDENT** accounts only. ADMIN, LECTURER and LAB_ASSISTANT accounts are created by an administrator.
5. Passwords require at least 12 characters and are bcrypt-hashed with cost 12. Passwords over 72 UTF-8 bytes are rejected to avoid bcrypt truncation.
6. Login has rate limiting. Helmet security headers and JSON body size limits are enabled.
7. API authorization is enforced on the server, not just by frontend route guards.
8. User deletion is implemented as deactivation so booking/audit history remains referentially intact.
9. No production demo credentials or demo records are seeded automatically.
10. Audit records are written for important user, venue, booking and request operations.

**Session note:** `sessionStorage` reduces persistence compared with `localStorage`, but bearer tokens remain accessible to JavaScript. A university production deployment should add a stronger session design (preferably same-site `HttpOnly`, `Secure`, `SameSite` cookies with CSRF protection, or an identity provider) and a content security policy tailored to the frontend.

## Requirements

- Node.js 20 or newer
- PostgreSQL 16 or newer, with permission to enable `btree_gist`
- Docker + Docker Compose (optional, for containerized local run)

## Run locally without Docker

### 1. Create PostgreSQL database and user

Create a database and a least-privilege application user in PostgreSQL. Example commands (run as a PostgreSQL administrator; replace credentials):

```sql
CREATE USER uvms_app WITH PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
CREATE DATABASE uvms OWNER uvms_app;
```

The migration enables `pgcrypto` and `btree_gist`. The database role needs permission to create extensions; alternatively ask the database administrator to enable those extensions first.

### 2. Configure backend

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` and set:

- `DATABASE_URL` to the PostgreSQL connection string
- `JWT_SECRET` to a new random value (example generator below)
- `CLIENT_URL` to the exact frontend origin
- `ALLOWED_REGISTRATION_DOMAINS` to the university email domain(s), comma-separated
- `NODE_ENV=development`

Generate a secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Install, migrate, and start:

```powershell
npm install
npm run db:migrate
npm run dev
```

The API defaults to port 5001. For local development, the registration-domain restriction can be left empty; production refuses to start until approved university email domains are configured. `GET /api/health` checks API and database connectivity.

### 3. Configure and start frontend

In a second terminal:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

The Vite development proxy forwards `/api` to `http://localhost:5001`. To use another local API target, configure the Vite proxy in `frontend/vite.config.js`. The browser app runs on Vite's configured development port.

## Create the first administrator

There is no default admin account. After applying the database migration, set these variables in the backend environment and run the CLI:

```text
ADMIN_NAME=University Administrator
ADMIN_EMAIL=admin@your-university.example
ADMIN_PASSWORD=<unique password of 12-72 UTF-8 bytes>
```

Then run:

```powershell
cd backend
npm run admin:create
```

The CLI prints the created email only. Do not place the password in source code or commit it. Remove the temporary environment variables after the operation.

## Development-only demo data

Demo fixtures are optional and disabled by default. The seed command refuses to run if `NODE_ENV=production` or `ENABLE_DEMO_SEED` is not exactly `true`. If no local fixture file exists, it uses the empty example fixture and still seeds the demo administrator.

1. Set `DEMO_ADMIN_NAME`, `DEMO_ADMIN_EMAIL`, and a unique `DEMO_ADMIN_PASSWORD` (12-72 UTF-8 bytes) in `backend/.env`; replace the example values.
2. Set `NODE_ENV=development` and `ENABLE_DEMO_SEED=true` in your local environment.
3. Optionally copy `backend/config-demo-data.example.json` to `backend/config-demo-data.json` and add local departments, venues, time slots and test users. For each test user, set a `passwordEnv` key whose value is provided as an environment variable; do not store plaintext passwords in the JSON file.
4. Run `npm run db:seed:dev`. Re-running the seed updates the demo administrator's password and reactivates the account.

The seed script is not part of Docker startup or cloud deployment. `.gitignore` excludes `.env` and local demo fixture files.

## Run with Docker Compose

From the repository root:

```powershell
Copy-Item .env.example .env
```

Edit `.env`. Use a long random hex password for `POSTGRES_PASSWORD` (for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and a separate generated `JWT_SECRET`.

```powershell
docker compose up --build -d
docker compose ps
```

The migration service runs once after PostgreSQL becomes healthy and records the applied baseline in `schema_migrations`. Add a new numbered SQL migration for future schema changes; do not edit an already-applied migration. The frontend is available at `http://localhost:8080` by default. The API is reverse-proxied through Nginx at `/api`; it is not published directly to the host.

Create the first admin from the backend container. Supply credentials securely through your shell environment; do not write them into the compose file:

```powershell
$env:ADMIN_NAME = "University Administrator"
$env:ADMIN_EMAIL = "admin@your-university.example"
$env:ADMIN_PASSWORD = "Use-A-Unique-Long-Password"
docker compose run --rm -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD backend npm run admin:create
Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

For local Docker, `CLIENT_URL` should be `http://localhost:8080`.

## Free-cloud deployment outline

The code is prepared for separate frontend and API deployments:

- **Frontend:** deploy `frontend` as a static site. Build command: `npm ci && npm run build`; publish directory: `dist`. Set `VITE_API_BASE_URL` to the full deployed API URL plus `/api` (for example, `https://YOUR-API-HOST/api`).
- **Backend:** deploy `backend` as a Node web service. Build command: `npm install`; start command: `npm start`. Set `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=true` where required by your provider, a newly generated `JWT_SECRET`, `CLIENT_URL` to the exact static-site origin, and `ALLOWED_REGISTRATION_DOMAINS` to the university-approved email domain(s). Set the provider's health-check path to `/api/health`.
- **Database:** provision managed PostgreSQL. Apply `backend/db/schema.sql` once using `npm run db:migrate` from a controlled release/deploy step. Do not run demo seeding in production.

Free hosting plans can sleep, impose database expiry/storage limits, and are not suitable for a critical university service. Check current provider limits before selecting a provider. A university-wide production system should use a supported paid database plan or university-managed PostgreSQL with automated backups, restore testing, TLS, monitoring and an incident-response owner.

See `MIGRATION_NOTES.md` for the collection-to-table mapping and the clean-database migration decision.

## Database integrity and concurrency

- Venue overlap is enforced with a PostgreSQL GiST exclusion constraint over `[starts_at, ends_at)` intervals.
- Lecturer overlap is enforced with a second exclusion constraint.
- Booking intervals are derived from editable time-slot records by a database trigger.
- A time-slot time edit refreshes all associated booking intervals; if it would create a collision, PostgreSQL rejects the edit.
- Booking and exchange writes use database transactions. Unique/exclusion conflicts return HTTP 409.

## API routes retained

The frontend's current API paths are retained for auth, users, venues, time slots, bookings, booking requests, lecturer exchanges, notifications, departments and courses. Some advanced workflows should receive full integration tests before a live university rollout; see the validation notes below.

## Validation status

This archive has been statically inspected and JavaScript syntax checks have been run. A full dependency installation, frontend production build, live PostgreSQL migration, end-to-end API tests and cloud deployment were **not** completed in this environment. Treat those as required next steps rather than assuming the application is production-certified.
=======
# UVMS
University venue management system
>>>>>>> 64945b39f337f5675c3d9a211f17c8535e9e053a
