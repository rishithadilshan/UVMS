# UVMS Playwright QA Suite

## Source inspection findings

This harness was prepared from the uploaded `uvms-optimized.zip`. The current code uses React 18 + Vite, Express 4, PostgreSQL, JWT and bcrypt. Frontend Vite defaults to port 5173; the local backend configured for this workspace runs on port 5050; Docker Compose exposes the frontend on 8080 through Nginx.

Authentication findings:
- `POST /api/auth/login` returns a JWT and safe user object.
- `GET /api/auth/me` validates the token and reloads role, active and approval state from PostgreSQL.
- Browser stores `uvms_token` and `uvms_user` in `sessionStorage`.
- Logout clears those session values.
- `/api/admin/*`, `/api/users/*` and `/api/maintenance/*` are Admin-only.
- Public registration permits Lecturer, Instructor and Student; Admin is created separately.

Booking findings:
- Lecturer and Instructor bookings become `CONFIRMED`.
- Student bookings become `PENDING` and require at least 10 characters of academic justification.
- Search requires venue capacity and all selected facilities to match.
- Booking creation checks date/time, category, participants and availability.
- Booking service locks the venue row; PostgreSQL exclusion constraints are a final overlap guard.
- Time calculations use Asia/Colombo.

## Role discrepancy

The uploaded application also includes `LAB_ASSISTANT` in the migration, seed data, role checks and UI. This suite tests only the four requested roles: Admin, Lecturer, Instructor and Student. It does not create another role or change the application's existing role model. The existing Lab Assistant implementation is not covered by these tests.

## Safety model

- Config refuses non-local frontend/API hosts.
- Use dedicated approved local QA accounts and a dedicated QA venue.
- No database drop, truncate, reset, migration, or direct SQL writes.
- Only bookings created by a test are cancelled through the application's own API.
- Optional database verification uses a local SELECT-only account and `BEGIN READ ONLY`.
- Do not run concurrency tests against a venue used by real users.

## Setup (PowerShell)

From the repository root (`uvms`):

```powershell
if (-not (Test-Path .\qa-playwright\.env.qa)) {
  Copy-Item .\qa-playwright\.env.qa.example .\qa-playwright\.env.qa
}
Set-Location .\qa-playwright
npm install
npm run install:browsers
```

Fill `qa-playwright\.env.qa` with a local QA `DATABASE_URL`, a generated `JWT_SECRET`, the four dedicated approved account credentials, a dedicated venue UUID and active category UUID. `QA_FACILITIES` is a comma-separated list of facilities actually on that venue.

Run each terminal's commands from the repository root (`uvms`). Run migrations against the isolated QA database once with the `DATABASE_URL` from `qa-playwright\.env.qa`. Start the QA backend in a separate terminal with these environment variables set from `qa-playwright\.env.qa`; the raised rate limits are only for the isolated local QA server:

```powershell
# Terminal 1
Set-Location .\backend
$qa = @{}
Get-Content ..\qa-playwright\.env.qa | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $qa[$matches[1]] = $matches[2] }
}
foreach ($key in @('DATABASE_URL','JWT_SECRET','PORT','CLIENT_URL','AUTH_RATE_LIMIT','GENERAL_RATE_LIMIT')) {
  [Environment]::SetEnvironmentVariable($key, $qa[$key], 'Process')
}
npm run db:migrate
npm run dev
```

```powershell
# Terminal 2
Set-Location .\frontend
$env:VITE_DEV_API_PROXY = 'http://127.0.0.1:5051'
$env:VITE_DEV_PORT = '5174'
npm run dev -- --host 127.0.0.1
```

Check `http://127.0.0.1:5174` and `http://127.0.0.1:5051/api/health`. If your ports differ, update `.env.qa`. Only localhost targets are allowed.

## Execute

Run these commands from `qa-playwright` (`Set-Location .\qa-playwright` from the repository root):

```powershell
Set-Location .\qa-playwright
npm test
npm run test:auth
npm run test:bookings
npm run test:headed
npm run test:ui
npm run report
```

Tests requiring missing credentials or venue fixtures are skipped with a reason.

## Optional database read-back

Set `QA_DATABASE_URL` to a local PostgreSQL URL for a SELECT-only account. It reads the test-created booking after creation and never changes data. Do not use a superuser.

## Failure evidence

`playwright-report/` contains the HTML report. `test-results/` stores screenshots, traces and videos on failure. View a trace:

```powershell
npx playwright show-trace test-results\<test-folder>\trace.zip
```

## Jenkins

Use a dedicated local/test Jenkins agent with Node 20+, access to the local app and local database. Save account credentials in Jenkins Credentials, never in source control. Example pipeline stages:

```groovy
pipeline {
  agent { label 'uvms-local-qa' }
  tools { nodejs 'Node20' }
  options { timestamps(); disableConcurrentBuilds() }
  environment {
    FRONTEND_URL = 'http://127.0.0.1:5173'
    API_URL = 'http://127.0.0.1:5050/api'
  }
  stages {
    stage('Install') {
      steps {
        dir('qa-playwright') {
          bat 'npm install'
          bat 'npx playwright install chromium'
        }
      }
    }
    stage('E2E') {
      steps {
        withCredentials([
          usernamePassword(credentialsId: 'uvms-qa-admin', usernameVariable: 'QA_ADMIN_EMAIL', passwordVariable: 'QA_ADMIN_PASSWORD'),
          usernamePassword(credentialsId: 'uvms-qa-lecturer', usernameVariable: 'QA_LECTURER_EMAIL', passwordVariable: 'QA_LECTURER_PASSWORD'),
          usernamePassword(credentialsId: 'uvms-qa-instructor', usernameVariable: 'QA_INSTRUCTOR_EMAIL', passwordVariable: 'QA_INSTRUCTOR_PASSWORD'),
          usernamePassword(credentialsId: 'uvms-qa-student', usernameVariable: 'QA_STUDENT_EMAIL', passwordVariable: 'QA_STUDENT_PASSWORD')
        ]) {
          dir('qa-playwright') { bat 'npm test' }
        }
      }
    }
  }
  post {
    always {
      publishHTML(target: [reportDir: 'qa-playwright/playwright-report', reportFiles: 'index.html',
        reportName: 'UVMS Playwright Report', keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
      archiveArtifacts artifacts: 'qa-playwright/test-results/**,qa-playwright/playwright-report/**', allowEmptyArchive: true
    }
  }
}
```

`disableConcurrentBuilds()` protects the shared QA venue from overlapping Jenkins runs. Jenkins agent must have local services running; the tests are not configured for production.

## Coverage status

| Area | Current suite |
|---|---|
| Invalid login | Implemented |
| Login, logout, session restore | Implemented for all four roles |
| Role-specific dashboard/navigation | Implemented |
| Admin API authorization | Implemented |
| Tampered JWT | Implemented |
| Invalid time window | Implemented |
| Capacity/facility search filters | Implemented |
| Lecturer booking + cleanup | Implemented |
| Student pending request + cleanup | Implemented |
| Admin approval of student request | Implemented |
| Calendar privacy (student vs admin) | Implemented |
| Optional database read-back | Implemented |
| Concurrent double-booking | Implemented |
| Admin venue UI smoke test | Implemented |
| Registration approval/rejection | Not yet implemented |
| Full venue CRUD | Not yet implemented |
| Booking rejection UI | Not yet implemented |
| Venue change workflow | Not yet implemented |
| Maintenance and waitlist lifecycle | Not yet implemented |
| Calendar privacy and check-in | Not yet implemented |
| Email/notification delivery | Not yet implemented |

This is an initial executable test harness, not a report of tests already passed. Execution requires your local app, approved QA accounts and dedicated test venue/category.
