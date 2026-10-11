# Contributing to Grand Theft Elections

Thanks for helping improve the map. Small, focused contributions are easiest to review. For a larger feature or a change to reporting, privacy or routing behaviour, open an issue first so we can agree on its scope.

## Set up locally

You’ll need Go 1.26 or later, Node.js 22 or later, and Docker with Docker Compose. CI currently uses Go 1.27.2 and Node.js 22; dependency versions are recorded in `go.mod` and `web/package-lock.json`.

From your checkout:

```sh
cp .env.example .env
# Edit .env: set DEV_AUTH_TOKEN to your own local development secret.
docker compose up -d --wait
npm ci --prefix web
set -a
. ./.env
set +a
go run ./cmd/gte
```

In a second terminal:

```sh
npm run dev --prefix web
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to the Go server on port 8080. Compose provides a local PostGIS database on port 55432 and Redis on port 56379. The Go process applies database migrations and creates the initial owner account specified by `OWNER_EMAIL`.

The local database starts with no refuges, and a walking graph is not bundled. You can develop the map, reports and console before preparing routing data.

### Operator access

Visit <http://127.0.0.1:5173/admin> directly. In development, use **Local development token** with the value you set in `.env`. This sign-in method is unavailable in production.

To exercise username/password sign-in locally, load `.env` in another terminal and run:

```sh
go run ./cmd/gte set-password --email "$OWNER_EMAIL"
```

The command prompts for a hidden password and confirmation. It only changes an existing enabled account, and resets revoke that account’s sessions. Passwords must contain at least 12 characters and fit within 72 bytes. Never pass a password as a command-line argument or commit it. Production setup is covered in the [operations runbook](docs/operations/runbook.md).

### Origins and phone previews

`PUBLIC_ORIGIN` must match the browser’s exact origin. Development also accepts the localhost origins listed in `.env.example`; additional preview origins belong in the comma-separated `DEV_ALLOWED_ORIGINS`. Production ignores this development list.

For another device on your Wi-Fi, replace `192.168.1.2` below with your computer’s LAN IPv4 address. After loading `.env`, restart the backend with:

```sh
LISTEN_ADDR=0.0.0.0:8080 DEV_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080,http://192.168.1.2:5173,http://192.168.1.2:8080" go run ./cmd/gte
```

Start the frontend with:

```sh
npm run dev --prefix web -- --host 0.0.0.0
```

Open `http://192.168.1.2:5173` on the other device. Browsing works over LAN HTTP, but phone geolocation requires trusted HTTPS. Use a trusted HTTPS proxy, or provide an existing certificate through both `DEV_TLS_CERT` and `DEV_TLS_KEY` when starting Vite. Add the exact HTTPS origin to `DEV_ALLOWED_ORIGINS` and establish certificate trust on the device. Keep certificates and private keys outside Git.

## Prepare walking routes (optional)

Download an OpenStreetMap PBF from [Geofabrik Northern Zone](https://download.geofabrik.de/asia/india/northern-zone.html), then run:

```sh
go run ./cmd/graphbuild -source /path/to/northern-zone.osm.pbf -out artifacts/routing
```

The importer clips to Delhi and conservatively excludes mapped access restrictions, conditional access and blocked barriers. Generated manifests and immutable 500 m routing tiles live under the configured `GRAPH_DIR`; the routing tile grid is independent of the 250 m reporting grid. Missing graph data produces an explicit routing error.

Graph downloads and generated artifacts stay out of Git. For deployment, publish tiles before switching the manifest and retain versions referenced by active clients. See the [runbook](docs/operations/runbook.md) for serving and rollout details, and [third-party notices](THIRD_PARTY_NOTICES.md) for OpenStreetMap data obligations.

## Check your changes

Use a dedicated local test database and Redis. Integration tests clear database state, and some require the database to be named exactly `gte_test`. Never point these commands at production or a database you want to retain.

Create the test database once (skip this if it already exists):

```sh
docker compose exec db createdb -U gte gte_test
```

Run the backend and frontend checks:

```sh
python3 -m unittest discover -s deploy/gcp/tests -v
TEST_DATABASE_URL='postgres://gte:local-only@127.0.0.1:55432/gte_test?sslmode=disable' \
TEST_REDIS_URL='redis://127.0.0.1:56379' \
go test -race ./...
go vet ./...
npm test --prefix web
npm run build --prefix web
```

Without the test service URLs, integration coverage may be skipped or fail. Avoid concurrent test runs against the same test database and Redis instance.

For browser checks, keep both local application servers running with the development token loaded. These tests submit reports and create labelled development-only refuge fixtures, so use only an isolated local/development instance:

```sh
cd web
npx playwright install chromium
DEV_AUTH_TOKEN='your-local-development-token' npm run e2e -- \
  e2e/map.spec.ts e2e/hotspots.spec.ts e2e/settings.spec.ts e2e/alerts.spec.ts
# Optional routing test: first restart the isolated backend with
# DEV_AUTH_TOKEN=local-development-only (the routing fixture uses this token).
DEV_AUTH_TOKEN=local-development-only E2E_ROUTING=1 npm run e2e
```

Replace the placeholder token with your local value. `E2E_URL` overrides the default local URL; do not use the live site. Match your checks to the change and describe what you tested in the PR. CI runs Go race tests and vet, frontend tests and build, and the browser suites above. Local tests do not establish production capacity or real refuge availability.

## Find your way around

| Path | Responsibility |
| --- | --- |
| `cmd/gte/` | Application entry point and password provisioning command |
| `cmd/graphbuild/` | OpenStreetMap walking-graph importer |
| `cmd/loadtest/` | Traffic harness for controlled load measurements |
| `internal/domain/` | Reporting rules and runtime-setting validation |
| `internal/platform/` | Database schema, persistence and migrations |
| `internal/httpapi/` | HTTP endpoints, authentication and live updates |
| `web/src/` | Public map, operator UI and browser routing worker |
| `web/e2e/` | Playwright browser tests |
| `deploy/gcp/` | GCP provisioning and bootstrap tooling |
| `docs/operations/` | Deployment, configuration and verification guidance |

Read [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md) and the [architecture notes](docs/architecture.md) before changing behaviour or the interface.

## Contribution guidelines

- Keep PRs focused and explain the user-visible problem and resulting behaviour. Follow existing Go and TypeScript patterns; format changed Go files with `gofmt`.
- Preserve daylight readability, mobile usability, keyboard access and clear location/connection states. Add relevant tests for behaviour changes; include desktop/mobile screenshots for visible UI changes.
- Keep report coordinates out of storage and logs after grid lookup. Do not expose anonymous session IDs, operator credentials, host contacts or private confirmation notes in public responses or screenshots.
- Use clearly labelled synthetic data only in isolated development environments. Never populate production with test reports or publish a test refuge as a real destination.
- Preserve cooldowns, rate limits, revision checks, audit records and last-owner protection. Changes to schema, authentication, runtime settings or live-update behaviour should include migration/rollout notes and meaningful verification.
- Keep assets original or appropriately licensed. Preserve map attribution and document new data or asset licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Do not add Rockstar artwork, logos, fonts, sounds or other game media.
- Keep `.env`, credentials, certificates, graph downloads and generated test output out of commits. Documentation screenshots belong in `docs/images/`; inspect them for private data and retain visible map attribution.

Create a branch from the latest `master`, commit your changes and open a pull request against `master`. Include a short explanation, verification results and any remaining limitations. Update related documentation when setup or behaviour changes, and let repository checks complete before requesting a merge.

For bugs, [open an issue](https://github.com/xdadwal/gte-vi/issues) with reproduction steps, expected/actual behaviour and relevant browser or device details. Remove credentials, cookies and precise personal locations from logs or screenshots. Report security-sensitive findings privately to the repository owner rather than posting exploit details or secrets in a public issue.

Contributions are made under the repository’s [MIT licence](LICENSE); third-party data and assets retain their own licences.
