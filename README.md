# Grand Theft Election VI

An original, daylight-readable Delhi community map. Anonymous visitors report their current 500 m area with 1–5 stars, see fresh reports, receive foreground proximity alerts, and preview walking routes to host-confirmed refuges. The private `/admin` console moderates contributions, manages refuges, records changes, and controls operator access.

This is a parody project, unaffiliated with Rockstar Games or the Grand Theft Auto franchise. Branding and interface assets are original. Community reports and mapped routes do not establish that an area or journey is safe.

[Desktop preview](docs/screenshots/map-desktop.png) · [Mobile preview](docs/screenshots/map-mobile.png)

## Run locally

Requires Go 1.26+, Node 22+, Docker Compose. Versions in CI and Docker are pinned; `go.mod` and `web/package-lock.json` are authoritative.

```sh
cp .env.example .env
# Set DEV_AUTH_TOKEN to a local secret in .env.
docker compose up -d --wait
npm ci --prefix web
set -a
. ./.env
set +a
go run ./cmd/gte
# In another terminal:
npm run dev --prefix web
```

Open <http://127.0.0.1:5173> or <http://127.0.0.1:5173/admin>. The console exposes local-token sign-in only in development. The default database contains **no refuges**. Browser geolocation requires localhost or HTTPS; reporting requires a fix within 30 seconds and 100 m accuracy.

Development also accepts `http://localhost:5173` and the built app at `http://127.0.0.1:8080` or `http://localhost:8080`. If you change preview ports, set `PUBLIC_ORIGIN` to the browser's exact origin or configure the comma-separated `DEV_ALLOWED_ORIGINS`. Production accepts only `PUBLIC_ORIGIN` and ignores development origins.

For devices on the same Wi-Fi, use the laptop's LAN IPv4 address (for example `192.168.1.2`) and restart both development servers:

```sh
# Backend terminal, after loading .env:
LISTEN_ADDR=0.0.0.0:8080 DEV_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080,http://192.168.1.2:5173,http://192.168.1.2:8080" go run ./cmd/gte
# Frontend terminal:
npm run dev --prefix web -- --host 0.0.0.0
```

Open `http://192.168.1.2:5173` from the other device. Replace the example IP with your current address. Local-network HTTP supports browsing and the development console, but browser geolocation requires a trusted HTTPS origin on phones.

For phone geolocation, create a local HTTPS certificate and trust its CA on the phone:

```sh
scripts/dev-cert.sh 192.168.1.2
# Add https://192.168.1.2:8443 to DEV_ALLOWED_ORIGINS and restart the backend.
DEV_TLS_CERT="$PWD/artifacts/tls/server.pem" DEV_TLS_KEY="$PWD/artifacts/tls/server.key" DEV_TLS_CA="$PWD/artifacts/tls/root.cer" npm run dev --prefix web -- --host 0.0.0.0 --port 8443
```

The secure map is `https://192.168.1.2:8443`. Download `/dev-ca.cer` from the HTTP preview (start it with `DEV_TLS_CA` set) to install the **GTE Local Development CA** on the test phone. Android: install it as a CA certificate in Encryption & credentials. iOS: install the profile, then enable full trust under General → About → Certificate Trust Settings. After trusting the CA, reload the HTTPS preview and use Report or the location button to request location access. Browser/app location permissions still apply.

The CA lasts one year and server certificates last 30 days. Re-running the script preserves the CA and issues a certificate for the current LAN IP. Keys remain in ignored `artifacts/tls`; the Vite download route serves only the public CA certificate, only in development. Remove the test CA from your phone when finished. Simply bypassing a certificate warning does not establish a trusted HTTPS setup.

## Prepare the walking graph

Download an OpenStreetMap PBF from [Geofabrik Northern Zone](https://download.geofabrik.de/asia/india/northern-zone.html), then:

```sh
go run ./cmd/graphbuild -source /path/to/northern-zone.osm.pbf -out artifacts/routing
```

The importer clips to Delhi, excludes mapped access restrictions, conditional access, blocked barriers, and foot-only one-way ways conservatively. It writes a content-versioned manifest and immutable 500 m tiles. Routing stays in a browser worker and includes the initial exit segment in its 3 km limit. Missing graph data produces an explicit error. A download is not bundled into Git or the application image.

Retain every version referenced by a deployed manifest. Publish tiles before atomically switching the manifest; serve them through a CDN with compression. See [operations](docs/operations/runbook.md) and [measured scope](docs/operations/verification.md).

## Verify

Integration tests clear a dedicated database whose name must end in `_test`:

```sh
docker compose exec db createdb -U gte gte_test
TEST_DATABASE_URL='postgres://gte:local-only@127.0.0.1:55432/gte_test?sslmode=disable' go test -race ./...
go vet ./...
npm test --prefix web
npm run build --prefix web
cd web
npx playwright install chromium
npm run e2e -- e2e/map.spec.ts
# Requires the real graph: E2E_ROUTING=1 npm run e2e
```

The browser tests require the local server/token above and create clearly labeled development-only refuge fixtures. Routing benchmark endpoints are synthetic and never published as refuges.

## Architecture and product decisions

Go HTTP API + PostgreSQL/PostGIS authoritative state + transactional outbox + Redis zone fanout and rate limits. React/MapLibre interface, client proximity checks, and replaceable browser routing worker. SSE takes a buffered authoritative snapshot, checks entity revisions including removal tombstones, falls back to polling, and closes on hidden tabs. Raw report coordinates are discarded after grid lookup.

[Product decisions](PRODUCT.md), [design direction](DESIGN.md), [specification](docs/superpowers/specs/2026-10-11-gte-vi-design.md), [execution plan](docs/superpowers/plans/2026-10-11-initial-release.md), [third-party notices](THIRD_PARTY_NOTICES.md).

The 100,000 concurrent-user goal requires deployed infrastructure measurements. Local checks do not establish production capacity or operational refuge availability.
