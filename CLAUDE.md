# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**oneresponse** is a network SLA monitoring tool inspired by ResponseWatch and SmokePing. It provides a dart/bullseye radar chart for real-time SLA compliance visualization, SmokePing-style time-series graphs, and a distributed probe architecture.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Backend**: Express.js serving both API and frontend
- **Frontend**: React 19 + Vite + D3.js (dart chart) + Chart.js (time-series)
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Monitoring**: ICMP ping via `child_process.exec`
- **Container**: Docker multi-stage build

## Commands

```bash
npm install            # Install dependencies
npm run dev            # Start backend (tsx watch) + frontend (vite) concurrently
npm run dev:server     # Backend only (port 3000)
npm run dev:client     # Frontend only (port 5173, proxies /api to :3000)
npm run build          # Build both client and server
npm run build:client   # Vite build → dist/client/
npm run build:server   # tsc → dist/server/
npm start              # Run production server (after build)
npm test               # Run tests with vitest
npm run lint           # ESLint
```

Docker:
```bash
docker compose up -d          # Build and run
docker compose up --build     # Rebuild and run
```

## Architecture

### Backend (`src/server/`)
- `index.ts` — Express entry point, serves API at `/api/v1/*` and static frontend
- `db/` — SQLite schema (groups, targets, measurements, peers, api_keys) and connection management
- `api/` — REST routes: `groups.ts`, `targets.ts`, `measurements.ts`, `peers.ts`, `router.ts` (also handles `/dashboard` and `/api-keys`)
- `monitor/prober.ts` — Executes `ping -c <count>` and parses output for RTTs, loss, jitter
- `monitor/scheduler.ts` — Loads enabled targets, dispatches them based on `probe_type`: ICMP targets to `prober.ts`, Cisco-IP-SLA targets to the collector below. Cisco targets are grouped by device so one SNMP session per cycle covers all operations on that device.
- `monitor/scoring.ts` — SLA score: weighted combination of latency (40%), jitter (30%), loss (30%) vs group thresholds
- `monitor/cisco/` — Cisco IP SLA collector. `mibConstants.ts` lists every numeric OID we read with citations back to CISCO-RTTMON-MIB; `snmp.ts` wraps `net-snmp`; `collector.ts` exposes `testConnection`, `discoverOperations`, `pollOperation`, `pollAllOperations` plus pure `normaliseEcho` / `normaliseJitter` functions (unit-tested in `collector.test.ts`); `secret.ts` encrypts SNMP credentials at rest with `ONERESPONSE_SECRET_KEY`.
- `peer/` — Push measurements to remote peers (`client.ts`), pull from peers (`server.ts`)

### Frontend (`src/client/`)
- `components/DartChart.tsx` — D3.js polar chart: segments = groups, dots = targets, green/red zones
- `components/TimeSeriesGraph.tsx` — Chart.js line chart with min/avg/max bands, loss-colored points
- `pages/Dashboard.tsx` — Main view with dart chart and group filter
- `pages/TargetDetail.tsx` — Per-target drill-down with time-range selector
- `pages/TargetManager.tsx`, `GroupManager.tsx`, `PeerManager.tsx` — CRUD management pages

### Key Design Decisions
- SQLite chosen for zero-dependency deployment (single Docker container)
- `ping` command used instead of raw sockets (no CAP_NET_RAW needed for basic operation)
- Scheduler reloads targets every 60s to pick up config changes without restart
- SLA score ≥ 70 = compliant (green), < 70 = breached (red)
- Peer communication uses API key auth via `X-API-Key` header
