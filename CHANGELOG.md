# Changelog

## 0.2.0 — 2026-07-06

### Look & feel
- New VMware vRNI / Clarity-inspired design: deep blue-teal dark theme (now the
  default), cyan accent, matching light theme with the dark header kept in both.
- Status colors exposed as theme variables (`--ok` / `--warn` / `--crit`) and
  used consistently across every page — no more hardcoded status hex colors.
- Modern chrome: sticky header with top-level navigation (Dashboard / Status /
  Top 10), restyled group pills, buttons, and drawer.

### Client status page
- New **Status** page: every target with a computed verdict — **alive**,
  **dead** (100% packet loss, or no data within 3× its probe interval),
  **no-data**, or **disabled** — with the reason shown per row.
- Clickable summary tiles, free-text search, group / probe-source / status
  filters, 30s auto-refresh.
- CSV export of both the filtered view (client-side) and the full dataset
  (`GET /api/v1/status/export.csv`).
- New `GET /api/v1/status` API endpoint, covered by tests.

### Cisco IP SLA separation
- Dashboard panes gained an **All sources / Local ICMP / IP SLA** filter so
  device-sourced probes can be viewed on their own radar.
- vRNI-style summary strip on the dashboard: Targets / Local ICMP /
  Cisco IP SLA / Peers counts with red "Breached" / "Unreachable" chips.
- Targets page split into **Local (ICMP)** and **IP SLA (Cisco)** tabs, plus a
  free-text filter.
- Cisco IP SLA points on the dart chart are marked with a cyan ring
  (dots, placeholders, legend, and tooltip badge).

### Targets management
- Multi-select with bulk actions: enable, disable, move to group, delete
  (`POST /api/v1/targets/bulk/update` and `/bulk/delete`).

### Dashboard & peers
- Unreachable peers no longer block the dashboard: the local radar paints
  instantly and each peer pane loads independently with its own loading
  placeholder (`/dashboard/local`, `/dashboard/peers`, `/dashboard/peer/:id`;
  `/dashboard/aggregate` kept for API back-compat).
- Responsive layouts throughout — fluid form grids, horizontally scrollable
  tables, and mobile-friendly chrome.

### Fixes
- `/dashboard/peer/:id` honors the disabled / pull-direction peer state, so a
  disabled peer can no longer be force-contacted via its id.
- Production start (`npm start`) no longer crashes on Node 22+ (replaced the
  removed `import … assert { type: 'json' }` syntax).

## 0.1.0

Initial release: dart/bullseye SLA radar, SmokePing-style time-series graphs,
ICMP probing, Cisco IP SLA collection via SNMP, groups with SLA thresholds,
peers, API keys, CSV import/export, and Docker deployment.
