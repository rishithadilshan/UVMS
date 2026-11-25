# Security and deployment checklist

## Before sharing or deploying

- [ ] Rotate any database password or JWT secret that appeared in the uploaded archive or its Git history.
- [ ] Do not reuse secrets from the original MongoDB project.
- [ ] Remove old repository history from any public remote if it contains secrets; rotate first because history removal does not invalidate leaked credentials.
- [ ] Set unique `DATABASE_URL`, `JWT_SECRET`, exact `CLIENT_URL` and `ALLOWED_REGISTRATION_DOMAINS` values in the hosting provider's secret manager.
- [ ] Enable TLS for managed PostgreSQL connections.
- [ ] Restrict database network access to the application provider where possible.
- [ ] Create the first administrator through the CLI; do not enable public ADMIN registration.
- [ ] Confirm registration creates students only and staff roles require admin provisioning.
- [ ] Add university email verification or institutional SSO; a domain allowlist alone does not verify mailbox ownership.
- [ ] Configure database backups and perform a restore test.
- [ ] Configure monitoring, log retention and an incident contact.
- [ ] Add a Content Security Policy and move to `HttpOnly` secure cookies or an institutional identity provider before production use.
- [ ] Test authorization on every protected endpoint with each role.
- [ ] Test simultaneous booking attempts and overlapping intervals for both venues and lecturers.
- [ ] Test lecturer exchanges, request approvals, cancellation and time-slot edits against real PostgreSQL.

## Sensitive values found in the source archive

The uploaded archive included a backend `.env` file and Git metadata. This rebuild deliberately excludes `.git`, `.env` files, and local secrets. Assume credentials in the original archive are compromised and rotate them. The rebuilt archive does not reproduce the values.
