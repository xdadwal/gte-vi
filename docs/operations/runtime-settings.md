# Runtime settings

Open `/admin` directly and choose Settings. Owners can edit; other approved operators can read. Public map navigation does not expose operator sign-in.

## Editing

The form groups reports, alerts, walking/location and map appearance; Advanced contains refresh, stream and cache timings. Each field displays its unit and bounds. Enter a change reason and Save settings. The save applies the whole validated draft atomically and records its previous/new revision and values in Activity history. Restore defaults changes the draft only; review and save it with a reason. Discard restores the currently loaded saved values.

Automatic refresh never overwrites an unsaved draft. A concurrent save produces a revision conflict; refresh the saved version and review the draft before retrying. Leaving with unsaved changes warns before discarding them. Settings writes require current owner membership and CSRF protection.

## Effects

| Group | Controls |
| --- | --- |
| Reports | Expiry, distinct-session activation threshold, latest-rating window, active buffer per star, pending buffer, submission cooldown, hourly session cap and network request cap |
| Alerts | Allowed radius range/step/default, repeat cooldown, severity escalation and re-entry delay |
| Walking/location | Maximum route distance, ETA speed, off-route distance/delay, accepted location accuracy/age and report hold duration |
| Map | Initial centre/zoom, five star colours and active/pending gradient opacity |
| Advanced | Fallback polling, overview/admin refresh, stale timeout, SSE heartbeat, reconnect bounds and polling snapshot cache lifetime |

Existing defaults are retained until explicitly changed. User radius and sound preferences stay personal. A new default radius applies to new visitors; an existing radius is preserved while allowed, and clamped to the nearest allowed choice if the allowed range/step changes. Map starting position applies at initialization and does not move someone who has already panned the map. Routing-rule changes mark an existing route for recalculation rather than automatically choosing a new route.

Shortening report expiry caps the expiry of still-live reports at their submission/update time plus the new duration. Increasing it affects future submissions only. Expired contributions are never revived, including by restoring defaults. Activation, rating-window and buffer changes recalculate current incident states and publish the resulting revisions. A save that only changes client presentation/timing does not need a zone recalculation.

## Distribution and recovery

PostgreSQL holds the authoritative singleton `{revision, values}`. Backend replicas cache it and monitor for new revisions. Settings changes are included in the transactional outbox and broadcast to all zone streams; snapshots also contain settings for reconnect/polling recovery. Clients accept newer revisions and refresh after returning to the foreground or reconnecting. Propagation is asynchronous; it does not require a reload or new frontend build.

`GET /api/v1/settings` returns the public cached settings. `GET /api/v1/admin/settings` requires an operator session and returns current values and defaults. `PUT /api/v1/admin/settings` requires an owner session, `X-CSRF-Token` and `{revision, values, reason}`; stale revisions return 409. All supported fields must be supplied by the form, and unknown fields are rejected.

Changing report policy during high traffic may briefly serialize writes while zones are recalculated. Tune polling and heartbeat intervals conservatively: shorter intervals increase traffic at large client counts. Proxy idle timeouts must remain greater than the configured heartbeat; changing an application setting does not reconfigure the proxy.

The 250 m reporting grid, metric projection, Delhi boundary, walking graph structure, credentials, OIDC, database/Redis addresses, origins and proxy trust remain deployment configuration. Report star choices stay 1–5. This page does not seed mock data or introduce official severity overrides.
