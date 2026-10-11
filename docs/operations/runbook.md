# Operating the application

## Deployment inputs

Provide HTTPS `PUBLIC_ORIGIN`, a real `OWNER_EMAIL`, PostgreSQL/PostGIS and Redis URLs, and an OIDC issuer/client with callback `${PUBLIC_ORIGIN}/api/v1/auth/callback`. Register that callback exactly. Supply `OIDC_CLIENT_SECRET` if required by the identity provider. Verified email and the database allowlist both gate access. Production rejects development-token authentication and a non-HTTPS origin. No deployed credentials or genuine hosts are seeded.

Build `Dockerfile`; mount the generated graph read-only at `/app/routing`, or route graph URLs directly to its CDN. Configure a basemap via frontend `VITE_MAP_STYLE` when building. The image runs as an unprivileged user and contains no graph download or secrets.

`APP_ROLE=all` is convenient initially. For independent scaling use:

| Role | Responsibility |
| --- | --- |
| `api` | Writes, polling, public/admin/auth endpoints; no expiry or subscription receiver |
| `gateway` | Zone subscription receiver and HTTP streams; no expiry worker |
| `worker` | Expiry and transactional outbox publication; internal HTTP health only |

Route `/api/v1/events` to gateways, other API traffic to API replicas, and static/map/graph files through a CDN. Keep workers private. Every role uses shared PostgreSQL and Redis. Schema bootstrap takes a database advisory lock and executes in one transaction. Owner bootstrap inserts only if absent; it does not restore revoked access on restart.

Terminate TLS at a trusted proxy. Preserve same-origin cookies and Origin. Disable SSE buffering and compression; permit idle streams beyond the configured heartbeat (default 15 seconds). Set per-process open-file limits to at least 65536 and independently budget gateway replicas and database pool connections. Go's request-header timeout is 5 seconds and stream writes time out after 10 seconds to shed slow receivers. Zone queues are bounded; overflow requires a fresh snapshot.

Example proxy settings for the SSE location:

```nginx
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_buffering off;
proxy_read_timeout 75s;
```

Set `TRUSTED_PROXY_CIDRS` only to proxies that **replace** `X-Real-IP`. Direct traffic ignores that header. Adjust network admission limits in owner Settings according to measured shared-network traffic; default 300/IP/min applies to new anonymous sessions, reports, and OIDC login starts. Session reporting defaults remain 30 seconds and 30 per hour. `NETWORK_RATE_PER_MINUTE` is deprecated and ignored; persisted settings are authoritative. Redis admission remembers idempotency keys so a failed admitted write can retry without waiting for another cooldown.

Tune the pgx pool through the database URL (`pool_max_conns`, `pool_min_conns`); count connections across every API/gateway/worker replica. Avoid unbounded autoscaling into a database connection ceiling. The published capacity goal needs deployed tests, not extrapolation from this laptop.

## Freshness and recovery

Report expiry runs each second. The database records the last completed expiry transaction; snapshots fail closed if its lease exceeds three seconds. Gateways monitor that lease and close streams if it lapses. Redis reconnect resets subscribers and requires a new authoritative snapshot. Buffered updates are compared against snapshot revisions, including empty-cell tombstones. SSE snapshots are never served from the polling cache.

Polling snapshots use a bounded 256-entry, 256 KB-per-entry cache for the configured lifetime (default 500 ms); concurrent identical reads share one query. Refuge SSE events refresh through `/api/v1/refuges`, which reads authoritative public details and bypasses that cache. Slow/missing data disables route calculation and stale admin mutations.

The outbox coalesces changes to the same cell within a publication batch, preserving the newest revision. PostgreSQL retains each submitted report and audit; subscribers receive current cell state rather than every intermediate rating. Publication retries may duplicate messages; revisions prevent regressions.

Monitor health, expiry lease, oldest unpublished outbox age, write/snapshot latency, stream counts/reconnects/overflow, Redis failures, database pool waits, graph downloads, and worker routing errors. Alert on expiry lag and outbox age before rollout. Production telemetry/export and infrastructure provisioning remain deployment work.

## Operator workflow

Approve verified operator emails in Team access. All approved operators can moderate reports and manage refuges; owners additionally control access and runtime settings. See [runtime settings](runtime-settings.md) for validated deployment-free tweaks and expiry semantics. The last owner cannot be removed/demoted. Revocation deletes that user's sessions and every API authorization also checks current membership.

Create draft refuges at the actual pedestrian entrance. Record host contact, confirmation date/notes privately, public access instructions, opening intervals, and Delhi-time date exceptions. Review the public preview before publishing. Archive withdrawn permission. Temporary closure requires manual reopening. No automatic incident overrides or official stars exist.

Incidents display the latest 100 fresh contributions; the count covers all fresh sessions and the the configured rating window (default latest 50) determines severity. Removal previews show the resulting total and severity. Hide suppresses all existing contributions with an audit reason; a later submission creates a new pending episode. Conflicts require reselecting against the current revision. Activity lists the latest 500 changes, including before/after state; durable audit remains in PostgreSQL.

## Data and backups

No raw GPS coordinates from reports are persisted. Only the resulting 500 m cell is stored. Browser cooldown/location state stays on the device; public responses omit session identifiers, host contact, and confirmation notes. Application logs do not record request bodies or cookies; apply that same restriction to proxies/APM. Refuges' public entrance coordinates and OSM graph nodes are intentional public map data.

Expired report contributions and published outbox rows are removed after an hour; receipts expire after an hour, anonymous sessions after 30 days, admin sessions after 8 hours, and login flows after 5 minutes. Expiry cleanup removes expired session rows only after their referenced reports/receipts are gone. Audit is retained. Back up PostgreSQL with access controls and an explicit retention policy; apply restricted access to host details and operator email records.

## Load harness

```sh
go run ./cmd/loadtest -url https://staging.example -clients 20000 -ramp 60s -duration 60m
go run ./cmd/loadtest -url https://staging.example -mode poll -clients 20000 -ramp 60s -duration 60m
go run ./cmd/loadtest -url https://staging.example -mode churn -clients 10000 -ramp 55s -duration 0s
```

The harness writes JSON metrics and exits nonzero on failures. `-cells` controls concentrated/distributed zone assignments across separate harness processes. The write mode is restricted to development servers and requires `-allow-synthetic-reports`; it creates a new synthetic browser session for each report at the central test cell. For that test only, place the load generator on a trusted isolated proxy subnet so its per-client `X-Real-IP` addresses are honored. Never configure that trust for arbitrary production clients.

```sh
go run ./cmd/loadtest -url http://isolated-development-server:8080 -mode write -allow-synthetic-reports -clients 110 -ramp 1s -duration 60s
```

Run concentrated and distributed workloads, reconnect bursts, polling fallback, Redis/worker failure, and expiry transitions together on the intended deployment. Validate p95 publication visibility and writes, one-hour stability, and a physical 4 GB Android browser before increasing exposure. Synthetic fixtures must never be used as genuine reports or published refuges.
