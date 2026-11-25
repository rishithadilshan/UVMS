# UVMS Selenium + Postman Test Kit

This is a starter automation kit for the University Venue Management System (UVMS).
It focuses first on the critical requirement: **two active allocations must never
overlap for the same venue and scheduling period**.

> **Important:** This kit has not been executed against your UVMS source code.
> The project-specific API routes, JSON fields, UI selectors, roles and status
> rules must be mapped before running the full tests. Do not run against production.
> Use a dedicated test database and disposable test accounts/venues.

## 1. What is included?

```text
uvms-selenium-postman-test-kit/
├── README.md
├── requirements.txt
├── .env.example
├── pytest.ini
├── selenium_tests/
│   ├── conftest.py
│   └── test_booking_ui.py
├── postman/
│   ├── UVMS_Booking_API_Tests.postman_collection.json
│   └── UVMS_QA.postman_environment.json
├── concurrency/
│   ├── concurrent-booking-test.mjs
│   └── package.json
└── sql/
    └── verify_booking_conflicts.sql
```

- **Selenium + pytest:** browser smoke test, login, booking form, and a UI conflict workflow.
- **Postman:** direct API checks for successful booking, duplicate/conflicting booking,
  and unauthenticated access.
- **Concurrency runner:** sends 2, 5, 10, 25 or 50 API requests together for the same
  venue/time slot and checks that no more than one request succeeds.
- **SQL:** example queries for independent inspection of active overlaps and timetable
  duplicates. Adjust table and column names to match your real schema.

## 2. Requirements

- Windows 10/11, macOS or Linux
- Python 3.10+
- Node.js 20+
- Google Chrome (or change the Selenium browser configuration)
- UVMS frontend and backend running locally
- A separate QA/test database
- Postman desktop app (optional, for importing and running the collection)
- PostgreSQL client such as `psql` (for SQL verification)

## 3. Install

Open PowerShell in the UVMS repository root. If you are already in the test-kit
folder, skip the first command:

```powershell
Set-Location .\uvms-selenium-postman-test-kit
if (-not (Test-Path .venv)) { py -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

These commands use the test kit's own Python environment; they do not depend on
the repository-root `.venv` being active. Activation is optional. If you prefer
to activate it, first make sure PowerShell is in the test-kit folder:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Selenium Manager normally obtains the matching ChromeDriver automatically.
Ensure Chrome is installed and can be launched.

## 4. Configure the test environment

Copy the environment template:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit the test-kit `.env` (do not overwrite an existing one). At minimum, set:

- `BASE_URL`: frontend URL, normally `http://localhost:5173`
- `LOGIN_URL`: full login page URL
- `BOOKING_URL`: full booking page URL
- `QA_USERNAME`, `QA_PASSWORD`: a disposable QA user
- `SEL_*_CSS`: CSS selectors that match your actual frontend

For this UVMS project, the frontend normally runs on port `5173` and the API on
port `5050`. Use the actual frontend URL printed by Vite if it selects another
port, and keep all three frontend URLs in `.env` consistent with it. The Vite
proxy forwards `/api` requests to the API on port `5050` by default.

The Selenium tests expect stable selectors. Best practice is to add `data-testid`
attributes to the frontend, for example:

```jsx
<input data-testid="login-email" ... />
<input data-testid="login-password" ... />
<button data-testid="login-submit" ... />

<select data-testid="booking-venue" ... />
<input data-testid="booking-date" ... />
<input data-testid="booking-start-time" ... />
<input data-testid="booking-end-time" ... />
<button data-testid="booking-submit" ... />
<div data-testid="booking-error" ... />
```

If your application uses different selectors, change the values in `.env`; you do
not need to change the Python test code. For custom controls, use a CSS selector
that Selenium can interact with, or update the test to use the correct interaction.
The current login page uses `#identifier` and `#password`, not the example
`data-testid` attributes. For login, selectors such as `#identifier`,
`#password`, and `form button[type='submit']` can be used. The booking selectors
and venue option value must still be mapped to the actual booking form.

## 5. Run Selenium tests

Run from the test-kit folder. Calling pytest through this environment's Python
avoids "`pytest` is not recognized" errors caused by activating a different
virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

Run only the UI test file:

```powershell
.\.venv\Scripts\python.exe -m pytest -v selenium_tests/test_booking_ui.py
```

Run headless:

```powershell
$env:HEADLESS="true"
.\.venv\Scripts\python.exe -m pytest -v
```

The browser tests are deliberately skipped when required configuration is missing.
A skipped test is **not** a pass. Configure the missing values and rerun.
Start the frontend and backend before running UI tests. If Selenium reports
`ERR_CONNECTION_REFUSED`, check that the frontend is listening at `LOGIN_URL`.
Booking tests create records, so use a QA database, disposable account, and a
fresh venue/date/time slot.

## 6. Run Postman API tests

1. Open Postman.
2. Select **Import**.
3. Import `postman/UVMS_Booking_API_Tests.postman_collection.json`.
4. Import `postman/UVMS_QA.postman_environment.json`.
5. Select the `UVMS QA - local` environment.
6. Set `baseUrl` to `http://localhost:5050`, then set `authToken`, `venueId`,
   `bookingDate`, `startTime`, and `endTime`.
7. For this UVMS backend, set `bookingCreatePath` to `/api/bookings`. Update the
   sample request body to use the API's camelCase fields:
   `venueId`, `date`, `startTime`, `endTime`, `categoryId`, `purpose`, and
   `participants`. A student booking also needs a `justification` of at least
   10 characters; an admin must include an approved user's `ownerId`.
8. Run requests in this order:
   - `01 - Create booking (valid)`
   - `02 - Create same booking again (conflict)`
   - `03 - Create booking without token (unauthorized)`

The collection contains editable placeholders and its sample body uses different
field names. Match its fields and expected statuses to the current backend:
booking creation returns `201`, a fully conflicting slot returns `409`, and an
unauthenticated request is denied.

### Run with Newman (optional)

Install Newman:

```powershell
npm install --global newman
```

Run after setting up the Postman environment:

```powershell
newman run .\postman\UVMS_Booking_API_Tests.postman_collection.json `
  -e .\postman\UVMS_QA.postman_environment.json
```

Use a real QA token and endpoint values. Avoid committing tokens or passwords.

## 7. Run concurrent booking tests

The Postman Collection Runner sends requests sequentially. It does **not** prove
race-condition safety. Use the Node.js runner included here for coordinated parallel
requests.

From this folder:

```powershell
cd concurrency
```

Set the API configuration in PowerShell (replace every example value):

```powershell
$env:UVMS_BASE_URL="http://localhost:5050"
$env:UVMS_BOOKING_PATH="/api/bookings"
$env:UVMS_AUTH_TOKEN="REPLACE_WITH_QA_TOKEN"
$env:UVMS_BOOKING_PAYLOAD='{"venueId":"REPLACE_VENUE_UUID","date":"2026-12-01","startTime":"09:00","endTime":"10:00","categoryId":"REPLACE_CATEGORY_UUID","purpose":"QA concurrency test","participants":10,"justification":"QA booking test"}'
$env:UVMS_SUCCESS_CODES="201"
$env:UVMS_CONFLICT_CODES="409"
```

The payload is an example for a non-admin QA user. For an admin, include
`"ownerId":"REPLACE_APPROVED_USER_UUID"`; for a student, keep a valid
`justification`. Obtain a token by signing in through the app or by calling
`POST /api/auth/login` with `{"email":"QA_EMAIL","password":"QA_PASSWORD"}`.
Do not include the word `Bearer` in `UVMS_AUTH_TOKEN`.

Run 2, 5, 10, 25 or 50 simultaneous attempts:

```powershell
node .\concurrent-booking-test.mjs 2
node .\concurrent-booking-test.mjs 5
node .\concurrent-booking-test.mjs 10
node .\concurrent-booking-test.mjs 25
node .\concurrent-booking-test.mjs 50
```

The script prints every response and fails if the number of successful responses is
not exactly one. If your API uses a different success/conflict status contract, update
the code or environment values accordingly.

**Important test-data rule:** each run must use a fresh venue/time slot, or clean up
all previous test allocations using your approved test-data reset process. Otherwise
a previous run may make all requests fail and produce a misleading result.

For multiple authenticated users, set `UVMS_AUTH_TOKENS` to a comma-separated list
of QA bearer tokens. The runner rotates through them. Do not include the word `Bearer`
in the token values.

## 8. Verify persisted data independently

A successful API response count alone is insufficient. After each concurrency run:

1. Query the booking table and confirm only one active allocation exists for the slot.
2. Query the timetable/allocation table and confirm there is exactly one matching row.
3. Check for any overlapping active allocations using `sql/verify_booking_conflicts.sql`.
4. Confirm rejected requests did not create hidden/duplicate rows.
5. Save the terminal output and SQL results as test evidence.

The SQL file uses **example table/column names**. Inspect your migrations/schema and
replace the identifiers and active-status list before executing it.
In this UVMS schema, bookings are stored in `bookings` with `venue_id`,
`starts_at`, `ends_at`, and `status`; both `PENDING` and `CONFIRMED` bookings
reserve a venue. The supplied SQL template is not directly executable against
this schema until it is adapted.

## 9. Booking conflict rule used by the test oracle

For half-open intervals `[start, end)`, two bookings overlap when:

```text
new_start < existing_end AND existing_start < new_end
```

Therefore `09:00–10:00` and `10:00–11:00` are adjacent and do not overlap.
A one-minute overlap such as `09:59–11:00` does overlap.

This interval policy is proposed by the supplied requirements; confirm that it is
the approved UVMS business rule. Also confirm which statuses reserve a venue.
Do not assume every status blocks availability.

University timezone: **Asia/Colombo**.

## 10. What must be mapped before declaring tests complete?

- Actual create, approve, update, cancel and availability API routes
- Actual JSON field names and response status codes
- Actual UI selectors / `data-testid` attributes
- Which booking statuses reserve the venue
- Which roles may create, approve, modify and cancel
- Whether pending requests temporarily reserve a venue
- Whether recurring and cross-midnight bookings are supported
- Actual booking and timetable database table/column names
- Database-level concurrency protection (transaction/locking/exclusion constraint)

## 11. Acceptance criteria

The critical booking module passes only when:

- No two active/reserving allocations for the same venue overlap.
- Sequential conflicts are rejected.
- Concurrent identical requests result in exactly one committed allocation.
- Adjacent bookings are accepted if the half-open rule is approved.
- Different venues can be booked at the same time where otherwise permitted.
- Failed modifications preserve the original allocation.
- Booking and timetable records remain consistent.
- Direct API requests cannot bypass authorization or conflict checks.
- Database state is independently verified after concurrency tests.

A single confirmed overlapping allocation is a **Critical failure**. Do not report
the module as passed based only on the UI showing a conflict message.
