# UVMS QA Test Plan

## Objective
Validate the uploaded UVMS implementation through local-only browser, API and optional read-only database checks. Test behavior must follow source implementation and must not relax application security.

## Scope and roles
The requested application roles are Admin, Lecturer, Instructor and Student. The uploaded code also includes `LAB_ASSISTANT`; this suite does not add, rename, or test that role.

## Environment
- Frontend: Vite development server, default `http://127.0.0.1:5173`
- API: Express, default `http://127.0.0.1:5050/api`
- Database: existing local PostgreSQL instance with migrations already applied
- Time zone: Asia/Colombo
- Browser: Chromium via Playwright
- Test data: dedicated approved accounts, dedicated venue and active booking category

## Entry criteria
1. Frontend and backend are running locally.
2. `/api/health` returns HTTP 200 and `database: connected`.
3. Four dedicated QA accounts exist, are active and approved.
4. Dedicated venue and booking category exist.
5. QA venue is not used by ordinary users.
6. `.env.qa` contains local URLs only and the config safety guard passes.
7. No production credentials, data or endpoints are configured.

## Exit criteria
- All in-scope tests pass or have documented defects.
- No test-created booking remains active.
- Failure artifacts and HTML report are retained.
- Every failure is classified as product defect, test defect, environment issue or data issue.
- No pre-existing database rows or users were changed/deleted by QA.

## Test case matrix

| ID | Role | Feature | Scenario | Expected result | Current automation |
|---|---|---|---|---|---|
| AUTH-001 | All | Login | Valid approved credentials | Login succeeds and correct role is shown | Implemented |
| AUTH-002 | All | Login | Invalid credentials | Error shown; no token stored | Implemented |
| AUTH-003 | All | Session | Reload after login | Session restored using `/auth/me` | Implemented |
| AUTH-004 | All | Logout | Log out | Session values removed and login screen shown | Implemented |
| AUTH-005 | All | Token | Tampered JWT | API returns 401 | Implemented |
| ROLE-001 | Admin | Authorization | Open admin dashboard and venue management | Admin pages accessible | Implemented |
| ROLE-002 | Lecturer | Authorization | Open admin route | Redirected to own dashboard | Implemented |
| ROLE-003 | Instructor | Authorization | Open admin route | Redirected to own dashboard | Implemented |
| ROLE-004 | Student | Authorization | Open admin route | Redirected to own dashboard | Implemented |
| API-001 | Lecturer/Instructor/Student | Authorization | Call admin-only APIs | HTTP 403 | Implemented |
| API-002 | Admin | Authorization | Call admin overview | HTTP 200 | Implemented |
| VEN-001 | Lecturer | Venue search | Invalid time window | HTTP 400 | Implemented |
| VEN-002 | Lecturer | Venue search | Capacity above venue capacity | Venue excluded from all result groups | Implemented |
| VEN-003 | Lecturer | Venue search | Request unavailable facility | Venue excluded from all result groups | Implemented |
| BOOK-001 | Lecturer | Booking | Valid booking | HTTP 201 and CONFIRMED | Implemented |
| BOOK-002 | Student | Booking | Valid booking with justification | HTTP 201 and PENDING | Implemented |
| BOOK-003 | Lecturer/Instructor | Concurrency | Two requests for same venue/time | One 201, one 409; no double booking | Implemented |
| BOOK-004 | Student/Admin | Approval | Admin approves student request | CONFIRMED and visible to owner | Implemented (API) |
| BOOK-005 | Student/Admin | Approval | Admin rejects student request with reason | REJECTED and reason recorded | Planned |
| VEN-004 | Admin | Venue management | Create/edit/deactivate/reactivate venue | API and UI reflect changes | UI smoke only |
| REG-001 | Admin | Registration | Approve pending user | User becomes approved and can log in | Planned |
| REG-002 | Admin | Registration | Reject pending user | User cannot log in; rejection reason visible | Planned |
| CHANGE-001 | Lecturer/Instructor/Student | Venue change | Submit change request against another owner's booking | Request created only when eligible | Planned |
| CHANGE-002 | Booking owner | Venue change | Accept/reject incoming request | Correct booking and request state | Planned |
| MAINT-001 | Admin | Maintenance | Create and restore maintenance | Venue blocked then restored | Planned |
| WAIT-001 | Booking role | Waitlist | Join and leave waitlist | Own waitlist record created/cancelled | Planned |
| CAL-001 | Student | Calendar privacy | View another user's booking | No purpose or owner identity leaked | Implemented (API) |
| CAL-002 | Admin | Calendar | View booking details | Admin sees full event details | Implemented (API) |
| NOTIF-001 | All | Notifications | Read own notifications | Only own notifications returned | Planned |
| CHECK-001 | Booking owner | Check-in | Check in within allowed time window | Check-in recorded once | Planned |
| FORM-001 | Admin | Venue form | Missing name/capacity/building/type | Validation error; no record created | Planned |

## Detailed assertions
### Authentication
- Public registration permits Lecturer, Instructor and Student only.
- Admin creation is a separate administrative CLI path.
- Pending/rejected users cannot sign in.
- Role and approval status are reloaded from the database for authenticated requests.
- Do not trust role values supplied by the browser or token claims.

### Booking
- Lecturer/Instructor direct booking returns CONFIRMED.
- Student booking returns PENDING and requires academic justification of at least 10 characters.
- Participants must be positive and within venue capacity.
- All required facilities must be present.
- Start time must be earlier than end time and must pass configured max-duration rules.
- Existing PENDING and CONFIRMED bookings reserve the venue.
- Concurrent attempts must not create overlapping active reservations.
- Cleanup must only cancel a booking ID returned by the same test.

### Evidence
- Playwright HTML report.
- Screenshot, trace and video retained on failure.
- Browser page errors and console errors attached to failed tests.
- Optional database read-back uses SELECT only.

## Limitations
The initial automated suite covers core authentication, role protection, venue search and booking integrity. The planned workflows above require additional isolated fixture data and must be implemented after the local test accounts/venue are confirmed. No test has been executed against the user's local runtime yet.
