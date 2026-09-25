# httpbin.tools

httpbin.tools is a public webhook inspector for creating temporary endpoints, monitoring incoming HTTP requests in real time, and controlling the response returned to the caller.

The hosted application is available at [https://httpbin.tools.mauriziocarella.it](https://httpbin.tools.mauriziocarella.it).

## Features

- Public webhook endpoints with unguessable tokens and shareable workspace URLs.
- Live updates over Server-Sent Events with pause, reconnect status, and queued-event counts.
- Inspection of payloads, headers, query parameters, source IPs, response codes, and timings.
- Full-text, method, content-type, and time-range filters backed by SQLite.
- Raw and formatted payload views, cURL generation, and JSON export.
- Configurable responses with status codes, headers, body, delay, presets, templates, and random status codes.
- Conditional response rules for methods, paths, headers, and query parameters.
- Per-endpoint retention, event limits, sensitive-header redaction, and optional IP anonymization.
- Responsive React interface with light, dark, and system themes.
- Docker image, health check, Traefik routing, CI, release automation, and deployment to a VPS.

## Technology

- React 19 and TypeScript
- Tailwind CSS 4 and shadcn-style UI components
- TanStack Query and TanStack Table
- Zustand
- Fastify
- SQLite through Node.js `node:sqlite`
- Docker and Traefik

## Local development

Node.js 24 or later is required.

```bash
npm install
npm run dev
```

Vite serves the frontend on `http://localhost:5173` and proxies API and webhook traffic to Fastify on `http://localhost:3000`.

## Production build

```bash
npm ci
npm run typecheck
npm run build
npm start
```

## Docker

```bash
docker compose up --build
```

The application is exposed on `http://localhost:3000`. The `httpbin-data` volume stores the SQLite database across container restarts.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port |
| `DATA_DIR` | `./data` | SQLite database directory |
| `MAX_EVENTS_PER_ENDPOINT` | `500` | Default event limit for each endpoint |
| `DEFAULT_RETENTION_HOURS` | `168` | Default event retention in hours |
| `MAX_PAYLOAD_BYTES` | `2097152` | Maximum accepted request body size |
| `HOOK_RATE_LIMIT_PER_MINUTE` | `120` | Requests allowed per minute for each IP and endpoint |

## Example

Create an endpoint in the application, then send a request to its generated URL:

```bash
curl -X POST 'http://localhost:3000/hook/YOUR_TOKEN/orders?source=demo' \
  -H 'Content-Type: application/json' \
  -d '{"order":42}'
```

## Deployment

[`docker-compose.traefik.example.yml`](docker-compose.traefik.example.yml) shows a generic Traefik deployment. Copy it outside the repository, replace the example image and hostname, and keep the real production Compose file on the target server.

Tagged releases are built and pushed to `ghcr.io/mauriziocarella/httpbin`. The release workflow connects to the VPS, runs the server-owned Compose file, deploys the exact tagged image, and verifies the container health check. Source code and the production Compose file are never copied from the repository to the VPS.

The deployment workflow requires these repository secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_KNOWN_HOSTS`

## Data migration

Existing `relaybin.sqlite` databases are renamed automatically. When an older `relaybin.json` data file is present and the SQLite database is empty, the application imports its endpoints and events, then renames the source file to `relaybin.json.migrated`.

## Security model

The application does not require authentication. The global endpoint list is not exposed, and the unpredictable workspace ID acts as a shared access key. Deploy behind HTTPS and treat workspace URLs as secrets.

The built-in rate limiter is local to a single process. Multi-replica deployments should enforce a distributed limit at the reverse proxy or edge.

## License

Licensed under the [MIT License](LICENSE).
