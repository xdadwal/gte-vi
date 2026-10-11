# Runtime Settings Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the backend and frontend tasks, then review integration.

**Goal:** Edit the agreed runtime settings in admin without deployment.

**Architecture:** PostgreSQL revisioned singleton, transactional audited owner writes, cached backend reads, settings snapshots and outbox/SSE fanout. Typed frontend context drives reporting, alerts, routing, rendering and update loops.

**Tech Stack:** Go, PostgreSQL/PostGIS, Redis, React, TypeScript, MapLibre.

**Spec:** docs/superpowers/specs/2026-10-11-runtime-settings-design.md

## Global Constraints

- Preserve existing defaults, fixed 500 m grid, projection and Delhi boundary.
- No secrets, infrastructure controls, mock-data labeling or public admin link.
- Expected revision, owner role, CSRF and reason required for writes.
- Expired reports never revived; shorter expiry caps live reports, longer expiry applies to future reports.
- All runtime values must actually drive behavior, including messages and client-side routing.

## Review Focus

- Concurrent report/settings writes must produce coherent aggregation and expiry.
- Reconnect and polling recover missed settings events; clients preserve valid personal radius choices.
- New activation/window rules recalculate existing zones and publish changes.
- Invalid timing/radius relationships are rejected; defaults and unknown fields cannot silently bypass validation.
- Dirty settings drafts survive automatic refresh and show conflict handling.

### Task 1: Backend settings authority

Files: internal/domain/settings.go, internal/platform/settings.go, internal/httpapi/settings.go plus existing aggregation, schema, store, server and cache files.

- [x] Add typed defaults and bounded validation, tests for invalid and cross-field cases.
- [x] Add revisioned singleton migration and GetSettings/SaveSettings; audit reason/before/after, lock/conflict detection, live expiry cap, recomputation and outbox events.
- [x] Add public GET /api/v1/settings; admin GET/PUT /api/v1/admin/settings. Envelope `{revision,values}`, PUT `{revision,values,reason}`. Owner-only write, operator read.
- [x] Replace server-side report limits, location acceptance, expiry, aggregation, SSE heartbeat and snapshot-cache lifetime with coherent runtime settings.
- [x] Verify unit/integration/race tests on gte_test only.

### Task 2: Frontend settings and admin UI

Files: web/src/settings.tsx, web/src/AdminSettings.tsx, existing main/Admin/PublicMap/live/model/MapView/hotspots/HoldButton/routing files, styles and tests.

- [x] Add typed settings/defaults and provider; fetch public config, apply monotonic revision updates from SSE and polling, recover on visibility/reconnect.
- [x] Add Settings admin page with grouped fields, bounds/units/descriptions, reason, save/discard/defaults, unsaved guard and revision conflict handling. Owner writes; operators read-only.
- [x] Wire every client-side value, preserve valid stored preferences, dynamic route/copy/hold duration/ETA, map palette and opacity.
- [x] Verify TypeScript build and focused tests.

### Task 3: Integration, review and release

- [x] Review backend/frontend schema/default parity and behavior, add browser coverage for admin save/live propagation/restore plus auth, expiry and concurrency tests as needed.
- [x] Run Go race/vet, frontend tests/build and browser suite; restart local preview and verify actual URLs/health/authenticated settings.
- [x] Document settings and expiry semantics, commit feature, push existing feature branch and update PR. Confirm final CI/head/mergeability.
