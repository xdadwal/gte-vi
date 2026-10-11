# Grant Theft Elections design specification

The approved conversation and the implementation plan are the product authority. PRODUCT.md and DESIGN.md capture the agreed design brief.

## Public map
Delhi NCT only. Anonymous browser sessions. Fixed 250m square EPSG:32643 cells group reports and define public base geometry. Current GPS report fix <=30s old, accuracy <=100m. Exact coordinates discarded after grid lookup; never logged. One integer 1–5 rating/session/cell, replacement refreshes 30m expiry. 1–4 fresh sessions pending; >=5 active, latest 50 fresh session ratings determine average. Empty cells disappear; fresh reports start new episodes. Buffers: pending100m, active100m × unrounded average. Overlapping cells remain separate.

Alert radius500–3000m/500m, default1000m, measured from hotzone edge. Foreground only. First entry/activation and >=1-star escalation; 5m cooldown, 60s outside rearm. In-app banners, sound optional/off by default, no focus stealing. Enabled sound uses a louder 12s alternating pulse; a visible Ack button stops it and dismisses the toast. Sound also stops on opt-out, hidden tab or map unmount; the toast stays until Ack. No-current-reports copy never implies safety.

Report → choose1–5 stars → hold3s, brief selected-rating guidance, no preselection/extra confirmation. Release/drag-away/blur cancels. Idempotent submit, server acknowledgement before success, retry preserves stars. Browsing without location; Locate/Report/Find refuge asks permission.

## Live state
Zone-based single SSE connection/tab and snapshots. Client proximity and cooldowns. Snapshot-buffer handoff, revisions, removes, heartbeat15s, stale45s. Poll10s+jitter, reconnect backoff, refresh on zones/resume. Detailed subscriptions max4096cells, overview aggregates. Hidden tab closes stream. Redis failure forces resnapshot; transactional database outbox preserves reports.

## Routing/refuges
Browser worker, replaceable engine, versioned immutable OSM pedestrian graph tiles. Complete local3km coverage, no server fallback. Whole-edge checks, access/barriers, max3km including exit. Minimize distance inside initial overlapping hotzone union then total length, no reentry. No eligible route and missing-data failures differ. Current revisions validate results. Route line, live position, estimated time4km/h, no maneuver guidance. Affected/off-route warns and offers manual reroute.

Host-confirmed curated refuge at pedestrian entrance, public instructions, hours/exceptions Asia/Kolkata. Draft/published/archived independent of temporary closure. Confirmation valid until withdrawn. Eligible if published, open through ETA, manually available, outside all hotzones. No fabricated production refuges.

## Admin
OIDC approved small team, owner-only access administration, last-owner protection, revocation ends sessions. Admin removes contribution or hides episode with reason and audit. Hide suppresses old contributions; new reporting allowed. Cannot override stars or create official incidents. Revision conflicts require refreshed preview. One admin verifies/publishes refuge; host contact/confirmation private. Manual reopening after closure. Immutable audit with before/after state. Disable stale mutations.

## Operations
Postgres/PostGIS authoritative; Redis fanout/limits; CDN map+graph. Expiry <=5s deadline; expired contribution purge <=1h. Initial limits30s/session submission gap and30/hour, configurable network flood limits. Secure cookies, CSRF, authorization. No raw GPS/session IDs/host contacts publicly. Capacity targets are measurements, not promises.
