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
<img width="1073" height="1107" alt="Bildschirmfoto_20260519_112510-1" src="https://github.com/user-attachments/assets/fc576ecb-c4ed-4533-9710-1473c78ed460" />
<img width="1087" height="1112" alt="Bildschirmfoto_20260519_112852-1" src="https://github.com/user-attachments/assets/9068a252-d228-4d87-a27b-525a6832fb0a" />
<img width="1088" height="683" alt="Bildschirmfoto_20260519_112924" src="https://github.com/user-attachments/assets/c4c25d06-e437-47e4-9f5f-0a10e4f2dd8e" />


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

<img width="1102" height="1059" alt="Bildschirmfoto_20260519_113114" src="https://github.com/user-attachments/assets/984dcb70-d0d0-43b5-81a8-95406f863e1e" />


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

## Troubleshooting

### Container can't ping anything (not even the gateway)

`ping` needs two things inside a container:

1. **Permission to open ICMP sockets** — either `CAP_NET_RAW`, or the kernel sysctl `net.ipv4.ping_group_range` set so the running UID can use unprivileged ICMP. The shipped `docker-compose.yml` sets both, so this is handled for Docker and rootful Podman out of the box.

2. **A network driver that forwards ICMP** — this is where most container surprises happen:

   | Runtime / network mode | ICMP egress | Notes |
   |---|---|---|
   | Docker default (`bridge`) | ✅ | Works out of the box |
   | Rootful Podman (`bridge`) | ✅ | Works out of the box |
   | **Rootless Podman (`slirp4netns`, default)** | ❌ | slirp4netns does NOT forward ICMP through its NAT. Pings will fail even with the cap + sysctl set. |
   | Rootless Podman (`pasta`) | ✅ | Recommended for rootless. Podman 4.4+ |
   | `--network=host` | ✅ | Easiest workaround on any runtime; container uses the host's network namespace directly |

   **Fix for rootless Podman:** start the container with `--network=pasta` or `--network=host`. In the Podman GUI, set *Network mode* on the container.

   ```bash
   podman run --network=pasta -p 3000:3000 \
     -v oneresponse-data:/app/data \
     localhost/oneresponse:latest
   ```

You can verify ICMP works from inside the container with:
```bash
docker exec -it <container> ping -c 1 1.1.1.1
# or
podman exec -it <container> ping -c 1 1.1.1.1
```

## License

ISC
