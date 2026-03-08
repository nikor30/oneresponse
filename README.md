# oneresponse

Network SLA monitoring tool with a dart/bullseye chart visualization, inspired by [ResponseWatch](https://web.archive.org/web/2010/http://www.crannog-software.com/) and [SmokePing](https://github.com/oetiker/SmokePing).

## Features

- **Dart/Bullseye Chart** — Real-time polar visualization of SLA compliance across regions and sites. Green zone = compliant, red = breached. Hover for details, click for time-series graphs.
- **SmokePing-style Monitoring** — Periodic ICMP ping probes measuring latency (min/avg/max), jitter, and packet loss with configurable intervals and probe counts.
- **SLA Scoring** — Composite 0–100 score combining latency, jitter, and loss metrics against configurable thresholds.
- **Web GUI** — Manage targets, groups (regions/sites), SLA thresholds, and peers through the browser.
- **REST API** — Full CRUD API for integration with other tools.
- **Distributed Probing** — Connect multiple instances via API keys to measure from different network locations.
- **Docker Ready** — Single container with docker-compose support.

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
```

Open http://localhost:3000

### Development

```bash
npm install
npm run dev
```

This starts both the backend (port 3000) and frontend dev server (port 5173 with proxy to backend).

## Usage

1. **Create Groups** — Go to /groups and create region/site groups with SLA thresholds (e.g., "Dublin", "London").
2. **Add Targets** — Go to /targets and add IP addresses or hostnames to monitor within each group.
3. **View Dashboard** — The main page shows the dart chart with all monitored targets. Dots represent targets; their position indicates SLA compliance.
4. **Drill Down** — Click any dot to see a SmokePing-style time-series graph with latency, jitter, and loss history.

## API

All endpoints under `/api/v1/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/dashboard` | Dashboard data for dart chart |
| GET/POST | `/groups` | List / create groups |
| GET/PUT/DELETE | `/groups/:id` | CRUD group |
| GET/POST | `/targets` | List / create targets |
| GET/PUT/DELETE | `/targets/:id` | CRUD target |
| GET | `/measurements/:targetId?from=&to=` | Time-series measurements |
| GET/POST | `/peers` | List / register peers |
| POST | `/peers/push` | Receive data from remote peer |
| POST | `/api-keys` | Create API key |
| GET | `/api-keys` | List API keys |

### Authentication

For peer communication and write operations, use the `X-API-Key` header:

```bash
# Create an API key
curl -X POST http://localhost:3000/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "remote-probe", "permissions": "write"}'

# Push data from a peer
curl -X POST http://localhost:3000/api/v1/peers/push \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-key>" \
  -H "X-Peer-Id: <peer-id>" \
  -d '{"target_id": "...", "timestamp": 1234567890, ...}'
```

## Distributed Setup

To measure from multiple locations:

1. Deploy oneresponse on each probe location using Docker.
2. On each instance, create an API key with `write` permissions.
3. On the central instance, go to /peers and add each remote probe with its URL and API key.
4. Set direction to `push` (probes send data to central), `pull` (central fetches from probes), or `both`.

## Architecture

```
src/
├── server/
│   ├── index.ts          # Express server entry point
│   ├── db/               # SQLite database (better-sqlite3)
│   ├── api/              # REST API routes
│   ├── monitor/          # Ping prober, scheduler, SLA scoring
│   └── peer/             # Peer push/pull communication
└── client/
    ├── components/       # DartChart, TimeSeriesGraph, Layout
    └── pages/            # Dashboard, TargetDetail, managers
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_PATH` | `./data/oneresponse.db` | SQLite database path |

## License

ISC
