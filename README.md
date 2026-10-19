# CapreQR

For stable public scanning on Cloudflare Workers + D1, follow [CLOUDFLARE.md](CLOUDFLARE.md). Your `capre_db` binding is configured. The steps below describe the separate Next.js/PostgreSQL setup.

For free temporary scanning outside your Wi-Fi, see [PUBLIC-SCANNING.md](PUBLIC-SCANNING.md). Run `npm run tunnel` while the local app and database are running; download QR images again after its public address is configured.

Organization QR management using Next.js, TypeScript, Tailwind, PostgreSQL/Prisma, Google OAuth, Sharp/QRCode, and Recharts. No public registration, billing, scanner accounts, tracking cookies, or sample analytics. Dashboard numbers come from the database.

## Setup

Requires Node.js 22.12+ and PostgreSQL 16+.

1. `npm ci`
2. Copy `.env.example` to `.env`. Set a private `DATABASE_URL`, a randomly generated `AUTH_SECRET`, `AUTH_URL`, `QR_BASE_URL`, Google credentials, and `STAFF_EMAILS`. Never commit `.env`.
3. `npm run db:generate`
4. `npm run db:migrate`
5. `npm run dev`
6. In another terminal: `npm run worker`
7. Open <http://localhost:3000>, sign in, and create a QR.

For Docker PostgreSQL, set `POSTGRES_PASSWORD` in your shell, run `docker compose up -d`, and use that password in `DATABASE_URL`. The database port binds to loopback. Docker is optional.

Production: `npm run check:env`, `npm run build`, then run `npm start` and `npm run worker` as two supervised processes. Run migrations once before starting new web/worker instances. Web and worker share the database. The worker must run continuously; serverless request handlers alone do not drain the queue. No test-login bypass exists.

## Google staff sign-in

In Google Cloud Console, create/select a project and configure Google Auth Platform branding and audience. Create a **Web application** OAuth client with the dashboard origin, e.g. `https://staff.example.org`, and exact redirect URI `https://staff.example.org/api/auth/callback/google`. For local development register `http://localhost:3000/api/auth/callback/google` on a development client. Put credentials in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`; set `AUTH_URL` to the canonical dashboard origin. Only openid/email/profile scopes are requested.

List initial approved addresses in comma-separated `STAFF_EMAILS`. Its first address is the protected recovery owner; the remaining addresses initially have staff access. Optional `OWNER_EMAILS` overrides the recovery-owner list. Personal Gmail accounts work; Google Workspace is not required. Follow Google's audience/testing requirements before deployment. An approved, Google-verified email is required at sign-in **and every management request**. There is no public registration.

Owners see **Staff management** in the sidebar. Add an account's Google email, choose Staff or Owner, and save. No invitation email is sent; that person can use Google sign-in immediately. Owners can edit roles, revoke access with confirmation, restore access, and review access history. Staff manage QR codes, reports, and workspace preferences but cannot read or change the staff roster. Access changes are enforced on the next request, including existing sessions. Revoke access through this page for database-managed accounts; deleting an email from deployment settings does not erase an existing database grant.

Recovery owners are controlled through deployment settings and cannot be changed through the UI. Owners also cannot change their own access. These safeguards preserve a recovery path. To designate recovery owners explicitly, set comma-separated `OWNER_EMAILS` (Cloudflare secret or local `.env`); use only email addresses you control and trust.

For an existing Cloudflare deployment, run `npm run cf:db:remote` before `npm run cf:deploy`. For local PostgreSQL, run `npm run db:migrate` before starting the updated app. Local D1 uses `npm run cf:db:local`. These migrations add `StaffMember` without changing QR records.

Auth.js protects OAuth state and staff session cookies. Mutation APIs also require exact `Origin` matching `AUTH_URL`. Staff emails appear in staff sessions and audit records; scanner identities never do. `/dashboard` and all supported `/api/manage/*` operations enforce authorization server-side, including preview, downloads, CSV, and settings. Public `/{shortCode}`, `/signin`, `/api/auth/*`, and `/api/health` remain independent of dashboard authorization.

For separate staff and QR hostnames, route both to this app. Do not put a global sign-in gateway in front of the QR domain. Use a canonical `AUTH_URL`; do not trust arbitrary forwarded host headers at your proxy. [Auth.js Google setup](https://authjs.dev/reference/core/providers/google).

## Features and lifecycle

- Overview: code counts, range request totals, trend chart with expandable data table, top codes, recent codes.
- QR management: search, folder/tag/status filters, sorting, pagination, create/edit/duplicate, downloads, pause/reactivate, archive/unarchive.
- Details: permanent link/copy, destination, export size, lifetime/range counts, coarse device breakdown, dates, and latest 100 audit changes.
- Analytics: inclusive custom dates, daily/weekly/monthly grouping, top QR codes, folder comparisons, devices, aggregate CSV. CSV includes the top ten codes and complete folder/device groups. Historical folder comparisons use each QR's **current** folder.
- Settings: organization name, brand accent, IANA reporting timezone, detailed-event retention (1–3650 days).

Archive is separate from pause: archived codes are hidden by default while retaining their existing active/paused behavior. Duplicates receive a new permanent link, start active/unarchived, and have zero requests. Destination and lifecycle changes record the staff actor. Optimistic version checks reject conflicting edits.

## Permanent links and QR reliability

QR links use `QR_BASE_URL/{12-character random base64url code}` with 72 bits of randomness and a unique database constraint. They never expire automatically and have no application scan quota. A trigger forbids changing code identities or deleting published codes; archive instead. An exceptional random-code collision fails safely; retry creation.

`QR_BASE_URL` must be an organization-controlled origin without a path/query/credentials, using HTTPS in production. **Keep this origin unchanged after printing.** Maintain the domain, DNS, certificates, hosting, and database. Stable links depend on that infrastructure. Infrastructure moves must preserve the original domain and database identities.

Active links read the current destination on each request and respond with `302`, no-store/no-cache, CDN and surrogate cache-bypass headers. Configure the CDN to bypass caching for short-code routes. No login, form, or interstitial is shown. Paused codes return a branded `503` without a Location header. Missing links return `404`. HEAD does not count.

QR generation uses high error correction, a four-module quiet zone, dark-on-light contrast of at least 4.5:1, and at least four export pixels per module. Export PNG or SVG at 512–2048px in the UI (API supports 256px when sufficient). Optional logos accept only still PNG/JPEG under 500 KB and 16 million decoded pixels. They are decoded, stripped of metadata, resized, and re-encoded as PNG. SVG uploads are rejected. Logos occupy at most 18% of QR module width plus a background plate. PNG/SVG share the same design. Preview uses a labeled placeholder URL; save and download the real QR. **Test final exports on multiple devices at the intended print size/material.** Styling limits do not guarantee every camera/print will read correctly.

## Anonymous analytics

The public route resolves the QR, excludes recognizable bots/previews/prefetch/health checks using transient headers, and inserts a minimal event into PostgreSQL `PendingScan`. Queue acquisition/statement/application timeouts are bounded (default 150ms, configurable 25–500ms). An analytics failure never deliberately blocks a valid redirect. Timeouts or unavailable analytics can **undercount**; a late successful insert may still be processed once. No guaranteed-capture claim is made.

The worker claims batches with `FOR UPDATE SKIP LOCKED`. One transaction inserts a `ProcessedEvent` receipt, records the event, updates UTC-minute summary buckets and lifetime counts, and removes the queue row. Failure rolls back the batch. Multiple workers/retries cannot count an event twice. Minimal receipts are retained permanently so replay stays safe after detailed events are deleted.

Events contain only a unique request-event UUID, QR ID, UTC timestamp, coarse mobile/tablet/desktop/unknown category, and redirect/paused outcome. Event UUIDs identify requests, never visitors. No names, emails, phone numbers, IP addresses, full user agents, referrers, persistent visitor IDs, fingerprints, or analytics cookies are stored. No events are linked into visitor profiles.

Main totals count non-excluded **redirect requests**, not verified physical scans or unique people. Reloads and unrecognized automation can count again. Paused-page visits are reported separately. Counts update when the worker runs; backlog is shown in the dashboard. Detailed events are deleted hourly according to retention. UTC-minute summaries and bare deduplication receipts remain indefinitely. Monitor storage growth. Reports apply the configurable organization timezone, including DST and partial-hour offsets; changing timezone does not corrupt UTC aggregates. Date ranges are inclusive local dates, limited to five years per query.

Network/hosting infrastructure necessarily receives scanner IPs and user agents; on a shared domain a browser may send existing staff cookies. Public handlers do not read identities/cookies or persist headers. **Review CDN/proxy/hosting/APM/database logging before claiming end-to-end anonymity.** Disable access logs or redact IP, user agent, referrer, cookies, query parameters, and request bodies. Do not forward raw headers to third-party analytics/error services. Application errors use fixed messages without raw request bodies or URLs. Staff Google OAuth logging is governed by Google; public scanners do not contact Google through this application.

## Operations

- Serve HTTPS through a reverse proxy; allow QR routes independently of staff protection. Automate ACME renewals, monitor certificate expiry, enable registrar auto-renew/MFA, and alert before domain expiration. Never replace a printed hostname.
- Store production secrets in an environment/secret manager. Share `AUTH_SECRET` across replicas; rotating it signs staff out. Rotate Google/database credentials. Never use `NEXT_PUBLIC_*` for secrets.
- Use a least-privilege runtime database role without DDL/TRUNCATE rights; use a separate migration role. Database owners can bypass triggers, so restrict operator access.
- Management APIs limit approved staff to 240 requests/minute per email, shared in PostgreSQL. Public routes avoid per-scanner/IP counters. Apply generous CDN/WAF burst/DDoS protection, especially for unknown-path/404 floods, without aggressive challenges on ordinary valid links. Set request-body (~800KB) and connection limits at the proxy. Edge processing/logging of IPs must be included in the privacy review. No application scan-count quota exists.
- `/api/health` checks database connectivity without a scan event and returns only ok/unavailable. Supervise both processes. Alert on 5xx, redirect latency, worker restarts, enqueue timeouts/failures, connection pressure, and storage growth. Monitor queue age using `SELECT count(*), min("queuedAt") FROM "PendingScan";` and alert when oldest exceeds expected processing delay, e.g. 60 seconds. A healthy web/database probe alone does not verify a running worker.
- Enable encrypted database snapshots/WAL/PITR and document RPO/RTO. Logical backup example (POSIX): `pg_dump --format=custom --file=qr-backup.dump "$DATABASE_URL"`. PowerShell uses `$env:DATABASE_URL`. Store backups off-host, restrict access, and define backup retention separately. Back up routing/configuration securely.
- Restore into an empty isolated database using `pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" qr-backup.dump`. Stop writes/worker during a production restore, apply migrations against the restored database, verify short-code identities/counts, and resume services on the original public domain. Never regenerate codes. Preserve receipts when replaying queues. Regularly rehearse restoration before an incident.
- Event cleanup does not remove QR metadata, aggregate summaries, idempotency receipts, or staff audits. Backups have their own retention. Define staff-audit retention operationally. No permanent-delete API exists.

## Verification

```text
npm run typecheck
npm test
npm run build
npm audit
```

Integration tests require a **disposable migrated database named exactly `qr_integration_test`**. Set `INTEGRATION_DATABASE_URL` in your shell or `.env`, migrate it by temporarily pointing `DATABASE_URL` there, then run `npm run test:integration`. They TRUNCATE app tables; a database-name guard rejects normal databases. Tests use real PostgreSQL transactions and constraints, mocking only the staff session boundary. Coverage includes destination changes on printed links, anonymous redirects, active/paused/archive lifecycle, permanent identities, duplication, concurrent workers, retry receipts, retention, aggregates, API authorization, and Origin rejection. Unit tests include actual PNG QR decoding. Real Google consent must be verified with organizational credentials during deployment.

Remaining deployment inputs: Google OAuth client/audience, approved staff emails, organization QR domain, HTTPS host, managed PostgreSQL/backups, worker supervision, and infrastructure logging/alerting. No public deployment or real organization OAuth credentials are included.
