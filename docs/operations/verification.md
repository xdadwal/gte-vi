# Verification scope — 2026-10-11

These are local engineering measurements, not a production-capacity promise. Host: Apple M4, 10 CPU cores, 16 GB RAM; Docker VM approximately 7.75 GB RAM. PostGIS 17/3.5 runs through amd64 emulation, Redis 8, ARM64 Go load generator and server. The local development database contained synthetic reports only.

## Verified behavior

- Go race suite with a dedicated PostGIS test database and `go vet` passed. Covers aggregation/latest50, replacement/idempotency, activation, expiry, new episodes before the expiry worker, moderation, refuge privacy/revision conflicts, last-owner protection, worker lease rejection, zone fanout/slow receiver/reset, origin rejection and unauthenticated access.
- 19 frontend tests passed: constrained route geometry/search, metric grid and Delhi opening exceptions, continuous opening through ETA, cooldown/reentry and decimal escalation, hold cancellation, removal tombstones, authoritative refuge refresh, and delayed responses on a closed stream.
- Browser journeys passed for anonymous mobile reporting, operator draft/publication/closure, desktop/tablet/mobile overflow, and accessibility checks including contrast. Tested widths 390, 820, and 1440 px. A separate real-graph worker benchmark passed.
- The production frontend was exercised against both the Go static-file server and the built, unprivileged Docker image. All four browser journeys passed, including real-graph routing and live host closure marking the route affected. Docker image build and health checks passed.
- Independent code review identified five reporting/routing/reconnect issues and two recovery issues introduced by caching. All were fixed and reviewed again; no important recovery blockers remained.

## Runtime settings

Runtime settings verification: Go race tests and vet passed with dedicated PostGIS/Redis test services. New coverage includes bounded settings validation, owner/read-only authorization, CSRF, revocation, optimistic conflicts, audit records, expiry caps without resurrection, concurrent report admission/save coordination and changed Redis cooldowns. All 30 frontend tests passed. Six browser journeys passed locally, including the real walking graph and owner settings propagation to open SSE/polling maps, preserved personal radius, new visitor defaults and stale-save rejection. The mobile settings overflow regression passed separately after the navigation fix. Desktop and mobile HTTPS settings views were checked for overflow and serious/critical axe violations. Settings defaults were compared across Go and TypeScript. This does not extend the capacity measurements below; no new load benchmark was run.

## 250 m reporting grid

Go race tests and vet passed with dedicated PostGIS/Redis services; all 36 frontend tests and the production build passed. Tests cover adjacent 250 m subcells, measured 250 x 250 m public geometry, preserved legacy archives through expiry cleanup, idempotent migration, original and orphaned receipt invalidation, maximum-radius subscription coverage, and routing tile lookup independent of the reporting grid. The local database migration archived nine legacy incidents and two retained contributions. A 4,096-cell encoded snapshot request (61,481-byte URL) returned HTTP 200. All six HTTPS browser journeys passed, including hotspot star labels, mobile reporting, responsive/accessibility checks, real walking routes, and live settings propagation. The hotspot assertion now allows 15 seconds for cold external basemap readiness; the initial 5-second limit timed out before successful glyph requests completed. Independent review found a legacy receipt gap; the fix and scoped re-review passed. No capacity load test was rerun for the smaller grid.

## Hotspot visibility and rating guidance

Zone outlines are removed. Six local HTTPS browser journeys passed with stronger gradient cores, including all five selected-rating descriptions and the unchanged hold-to-submit flow. A subsequent hotspot check passed after the final paint adjustment, verifying that clicking the invisible zone footprint still opens incident details. All 36 frontend tests and the production build passed. Desktop/mobile hotspot and mobile rating screenshots were visually inspected. Hotspot screenshots use isolated browser fixtures; no incident data was seeded for this UI change. Existing 250 m geometry, severity buffers, alert rules and persisted opacity settings remain unchanged. No new capacity benchmark was run.

## Local load measurements (original 500 m reporting grid)

| Workload | Measured scope | Result |
| --- | --- | --- |
| SSE | 20,000 clients; 120-second steady period after ramp; 196.54 seconds total | Peak 20,000 streams; 0 failures; 221,425 snapshot/heartbeat events |
| Polling, before cache | 20,000 virtual clients; 60-second steady period | 0 failures; p95 response 4,723.73 ms — too slow |
| Polling, bounded cache | 20,000 virtual clients; 60-second steady period; 137.73 seconds total | 207,334 requests; 0 failures; p95 response 1.50 ms |
| Concentrated writes, with cached polling and reconnect traffic | 110 synthetic browser-session writers; approximately 61 seconds | 6,610 successful writes; 108.19 writes/s; 0 failures; p95 write 20.76 ms |
| Published state observation during that write run | One zone stream; 120 coalesced current-state updates | p95 age of received latest-state timestamp 20.89 ms |
| Stream reopening | 10,000 requests over 55 seconds | All 10,000 snapshots received; 0 failures; p95 handshake/snapshot 3.67 ms |

An earlier 20,000-stream test through Docker Desktop's host forwarding reached 16,339 connections with 3,661 connection failures and temporarily exhausted host outbound connections. The successful run used the internal Docker network. This demonstrates why the deployed network path needs its own validation.

The stream run measured snapshots/heartbeats, **not** 20,000 streams receiving concentrated report updates for an hour. The combined write/poll/reopen run did not include those 20,000 long-lived streams. Publication measurements concern received coalesced state, not visibility latency for every individual write. Distributed-zone workloads and deployment-scale soak tests remain open.

## Walking graph/browser measurements

Real Delhi OSM graph version `582f375d329f464e`: 708,258 edges across 5,871 immutable tiles. The central benchmark window loaded 169 tiles, 27,858 unique nodes and 31,122 edges: 5,140,071 raw tile bytes or 1,052,212 gzip bytes, plus a 270,325-byte manifest. These are a single-window measurement, not the maximum across Delhi.

The synthetic benchmark route was 801.11 m. Desktop Chromium first worker request measured 212.90 ms; ten subsequent worker requests measured warm p95 17.90 ms. Earlier fresh runs under different local load measured approximately 1.35–1.45 seconds for the first request. This does not establish Android performance. Actual worker heap was not measured.

## Remaining launch gates

- One-hour sustained 20,000 foreground sessions with report traffic, expiry transitions, concentrated and distributed zones, reconnect bursts, and polling fallback on the intended infrastructure.
- Deployed p95 current-state visibility <2 seconds and writes <500 ms, with representative network conditions, plus validated replica/database/Redis/CDN budgets toward 100,000 concurrent users.
- Physical 4 GB Android warm-route p95 <2 seconds, maximum 3 km graph transfer <10 MB across Delhi, and worker heap <100 MB.
- Real OIDC provider end-to-end sign-in/revocation, HTTPS domain/proxy configuration, host-confirmed operational refuges, and data/telemetry/backup arrangements.

Production credentials, infrastructure, and genuine refuge availability are deliberately not fabricated. The local application and implementation tests are ready; these rollout gates require the deployment and devices above.

The production frontend build reports a large MapLibre-containing entry chunk (approximately 1.46 MB raw / 414 KB gzip) and a separate map worker. Serve compressed immutable assets through a CDN; mobile startup performance remains part of deployment/device validation.
