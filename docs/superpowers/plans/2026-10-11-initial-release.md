# Grand Theft Election VI implementation plan

Goal: working anonymous Delhi map and private operator console.
Architecture: Go modular API, PostGIS authoritative state, Redis events, browser routing worker, React/MapLibre UI.
Spec: ../specs/2026-10-11-gte-vi-design.md
Execution: inline, independently testable milestones; final fresh review. Commit/push/open PR.

## Milestones
- [ ] Foundation: approved context, isolated branch, local database/Redis, Go/frontend/CI.
- [ ] Reports: grid, sessions, validation, idempotency, aggregation, expiry, snapshots.
- [ ] Browser routing: OSM graph builder, worker constrained search, geometry, mobile measurements.
- [ ] Live UI: map, hold interaction, SSE/poll recovery, alerts/cooldowns/stale state.
- [ ] Admin/refuges: OIDC roles, moderation, audit, publication/hours/closure, route journeys.
- [ ] Hardening: privacy/auth/recovery/browser tests, load harness, docs, review, PR.

## Acceptance
20K foreground sessions60m,100 writes/s,10K reopens/minute,20K polling fallback. p95 event visibility<2s and writes<500ms excluding network.4GB Android targets: warm route p95<2s, graph transfer<10MB, worker memory<100MB. Concentrated and distributed zones. Test hold cancellations, session replacements/latest50/expiry, grid boundaries, event races/removals/recovery, graph barriers/exclusions/exits, stale data, admin revisions/revocation/audit and private information exposure. Report actual measured scope; no unsupported production-capacity claims.

## Review focus
Session revocation across workers; snapshot-to-stream race; star expiry changing routes; cell boundaries and full-edge exclusion; route search labels preserving valid3km alternatives.
