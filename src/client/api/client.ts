const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin', // send the session cookie for protected routes
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Types
export interface Group {
  id: string;
  name: string;
  description: string | null;
  sla_latency_ms: number;
  sla_jitter_ms: number;
  sla_loss_pct: number;
  // Per-group visualization range. When null, the dart chart maps
  // 0 → center and 3 × sla_latency_ms → edge (current default).
  viz_latency_min: number | null;
  viz_latency_max: number | null;
  created_at: number;
}

export interface Target {
  id: string;
  group_id: string;
  name: string;
  host: string;
  site_code: string | null;
  probe_interval: number;
  probe_count: number;
  enabled: number;
  probe_type: 'icmp' | 'cisco-ipsla';
  device_id: string | null;
  ipsla_oper_index: number | null;
  ipsla_oper_type: string | null;
  created_at: number;
}

export interface CiscoDevice {
  id: string;
  name: string;
  host: string;
  snmp_port: number;
  snmp_version: '2c' | '3';
  v3_username: string | null;
  v3_auth_protocol: string | null;
  v3_priv_protocol: string | null;
  poll_interval_seconds: number;
  enabled: number;
  last_seen: number | null;
  last_error: string | null;
  created_at: number;
}

export interface DiscoveredOperation {
  index: number;
  tag: string;
  rttType: number;
  kind: 'icmp-echo' | 'udp-echo' | 'udp-jitter' | 'tcp-connect' | 'http' | 'dns' | 'unsupported';
  target: string | null;
}

export interface DeviceTestResult {
  ok: boolean;
  sysName?: string;
  sysObjectID?: string;
  error?: string;
}

// Shape of GET /api/v1/devices/:id/diagnostics — one in-process poll
// cycle per cisco-ipsla target on the device, with every stage's output.
export interface DeviceDiagnostics {
  device_id: string;
  device_name: string;
  host: string;
  snmp_version: string;
  ran_at: number;
  snmp_test: DeviceTestResult;
  targets_for_this_device: number;
  results: Array<{
    target_id: string;
    target_name: string;
    target_enabled: boolean;
    oper_index: number;
    oper_type: string;
    varbinds?: { name: string; oid: string; value: unknown }[];
    raw_values?: Record<string, number | null>;
    sense?: number | null;
    normalised?: Record<string, unknown>;
    would_insert?: Record<string, unknown>;
    note?: string;
    error?: string;
  }>;
  hint?: string;
}

export interface Measurement {
  id: number;
  target_id: string;
  peer_id: string | null;
  timestamp: number;
  latency_min: number;
  latency_avg: number;
  latency_max: number;
  jitter: number;
  loss_pct: number;
  probe_count: number;
  sla_score: number;
  // Individual ping round-trip times for this sample. Only populated when
  // the query is not bucketed (i.e. ≤ 24h ranges).
  rtts: number[] | null;
}

export interface DashboardTarget {
  id: string;
  name: string;
  host: string;
  site_code: string | null;
  probe_type: 'icmp' | 'cisco-ipsla';
  timestamp: number | null;
  latency_min: number | null;
  latency_avg: number | null;
  latency_max: number | null;
  jitter: number | null;
  loss_pct: number | null;
  sla_score: number | null;
  // Lifetime min/max latency across all stored measurements — drives the
  // permanent drift line on the dart chart.
  latency_min_lifetime: number | null;
  latency_max_lifetime: number | null;
  sample_count: number | null;
}

export interface DashboardGroup {
  group: {
    id: string;
    name: string;
    sla_latency_ms: number;
    sla_jitter_ms: number;
    sla_loss_pct: number;
    viz_latency_min: number | null;
    viz_latency_max: number | null;
  };
  targets: DashboardTarget[];
}

// One pane in the multi-instance dashboard. `peer_id == null` means the
// local node; otherwise it's a remote peer whose data we fetched live.
export interface DashboardNode {
  peer_id: string | null;
  peer_name: string | null;
  url: string | null;
  site_name: string;
  dashboard: DashboardGroup[];
  last_seen: number | null;
  error: string | null;
}

// Lightweight peer descriptor for the dashboard — no data fetched yet, so
// the frontend can render a placeholder pane immediately and load each
// peer's data on its own.
export interface DashboardPeerStub {
  peer_id: string;
  peer_name: string;
  url: string;
}

export interface Peer {
  id: string;
  name: string;
  url: string;
  direction: string;
  enabled: number;
  last_seen: number | null;
  last_error: string | null;
  created_at: number;
}

export interface PeerTestResult {
  ok: boolean;
  status?: number;
  elapsed_ms: number;
  url: string;
  site_name?: string;
  error?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  permissions: string;
  created_at: number;
}

export interface ApiKeyWithSecret extends ApiKey {
  // Only returned at creation time
  key: string;
}

export interface AuthStatus {
  admin_required: boolean;
  logged_in: boolean;
  username: string | null;
}

// One row of the client liveness view (GET /status).
export type ClientStatusKind = 'alive' | 'dead' | 'no-data' | 'disabled';

export interface ClientStatusEntry {
  id: string;
  name: string;
  host: string;
  site_code: string | null;
  group_id: string;
  group_name: string;
  probe_type: 'icmp' | 'cisco-ipsla';
  enabled: number;
  probe_interval: number;
  timestamp: number | null;
  latency_avg: number | null;
  jitter: number | null;
  loss_pct: number | null;
  sla_score: number | null;
  status: ClientStatusKind;
  status_reason: string | null;
  checked_at: number;
}

// API calls
export const api = {
  // Dashboard
  getDashboard: () => request<DashboardGroup[]>('/dashboard'),
  getDashboardAggregate: () => request<DashboardNode[]>('/dashboard/aggregate'),
  // Split endpoints so an unreachable peer never blocks the page: the local
  // radar paints immediately, then each peer pane loads independently.
  getDashboardLocal: () => request<DashboardNode>('/dashboard/local'),
  getDashboardPeers: () => request<DashboardPeerStub[]>('/dashboard/peers'),
  getDashboardPeer: (id: string) => request<DashboardNode>(`/dashboard/peer/${id}`),

  // Groups
  getGroups: () => request<Group[]>('/groups'),
  createGroup: (data: Partial<Group>) => request<Group>('/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateGroup: (id: string, data: Partial<Group>) => request<Group>(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (id: string) => request<void>(`/groups/${id}`, { method: 'DELETE' }),

  // Targets
  getTargets: (groupId?: string) => request<Target[]>(groupId ? `/targets?group_id=${groupId}` : '/targets'),
  getTarget: (id: string) => request<Target>(`/targets/${id}`),
  createTarget: (data: Partial<Target>) => request<Target>('/targets', { method: 'POST', body: JSON.stringify(data) }),
  updateTarget: (id: string, data: Partial<Target>) => request<Target>(`/targets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTarget: (id: string) => request<void>(`/targets/${id}`, { method: 'DELETE' }),
  // Bulk operations for the multi-select target table.
  bulkDeleteTargets: (ids: string[]) =>
    request<{ deleted: number }>('/targets/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  bulkUpdateTargets: (ids: string[], patch: Partial<Pick<Target, 'enabled' | 'group_id' | 'probe_interval' | 'probe_count'>>) =>
    request<{ updated: number }>('/targets/bulk/update', { method: 'POST', body: JSON.stringify({ ids, patch }) }),

  // Measurements
  getMeasurements: (targetId: string, from?: number, to?: number, bucket?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    if (bucket) params.set('bucket', String(bucket));
    return request<Measurement[]>(`/measurements/${targetId}?${params}`);
  },

  // CSV export URLs (used as href for downloads)
  exportMeasurementsCsvUrl: (targetId: string, from?: number, to?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    const q = params.toString();
    return `${BASE}/measurements/${targetId}/export.csv${q ? '?' + q : ''}`;
  },
  exportGroupMeasurementsCsvUrl: (groupId: string, from?: number, to?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    const q = params.toString();
    return `${BASE}/groups/${groupId}/measurements/export.csv${q ? '?' + q : ''}`;
  },
  exportGroupsCsvUrl: () => `${BASE}/groups/export.csv`,
  exportTargetsCsvUrl: () => `${BASE}/targets/export.csv`,

  importGroupsCsv: (csv: string) =>
    request<{ created: number; updated: number; errors: string[] }>(
      '/groups/import',
      { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } }
    ),
  importTargetsCsv: (csv: string) =>
    request<{ created: number; updated: number; errors: string[] }>(
      '/targets/import',
      { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } }
    ),

  // Peers
  getPeers: () => request<Peer[]>('/peers'),
  createPeer: (data: { name: string; url: string; api_key: string; direction?: string }) =>
    request<Peer>('/peers', { method: 'POST', body: JSON.stringify(data) }),
  updatePeer: (id: string, data: Partial<Peer & { api_key: string }>) =>
    request<Peer>(`/peers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePeer: (id: string) => request<void>(`/peers/${id}`, { method: 'DELETE' }),
  testPeer: (id: string) =>
    request<PeerTestResult>(`/peers/${id}/test`, { method: 'POST', body: '{}' }),

  // API keys (for granting other oneresponse nodes / peers access to this node).
  // Keys always carry read+write so a paired peer can both fetch our data and
  // push their own — there's no longer a permissions choice in the UI.
  getApiKeys: () => request<ApiKey[]>('/api-keys'),
  createApiKey: (name: string) =>
    request<ApiKeyWithSecret>('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteApiKey: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  // Instance-level settings (key/value), e.g. site_name
  getSettings: () => request<Record<string, string | null>>('/settings'),
  updateSettings: (patch: Record<string, string | null>) =>
    request<Record<string, string | null>>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // Cisco devices
  getDevices: () => request<CiscoDevice[]>('/devices'),
  createDevice: (data: Partial<CiscoDevice> & { community?: string; v3_auth_password?: string; v3_priv_password?: string }) =>
    request<CiscoDevice>('/devices', { method: 'POST', body: JSON.stringify(data) }),
  updateDevice: (id: string, data: Partial<CiscoDevice> & { community?: string; v3_auth_password?: string; v3_priv_password?: string }) =>
    request<CiscoDevice>(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDevice: (id: string) => request<void>(`/devices/${id}`, { method: 'DELETE' }),
  testDevice: (id: string) => request<DeviceTestResult>(`/devices/${id}/test`, { method: 'POST', body: '{}' }),
  diagnoseDevice: (id: string) => request<DeviceDiagnostics>(`/devices/${id}/diagnostics`),
  discoverOperations: (id: string) => request<DiscoveredOperation[]>(`/devices/${id}/operations`),
  importDeviceOperations: (id: string, group_id: string, operations: { index: number; type: string; target?: string | null; name?: string }[]) =>
    request<{ created: string[]; errors: string[] }>(`/devices/${id}/import`, {
      method: 'POST',
      body: JSON.stringify({ group_id, operations }),
    }),

  // Client liveness (alive/dead view)
  getClientStatus: () => request<ClientStatusEntry[]>('/status'),
  exportStatusCsvUrl: () => `${BASE}/status/export.csv`,

  // Auth
  getAuthStatus: () => request<AuthStatus>('/auth/me'),
  setupAdmin: (username: string, password: string) =>
    request<{ ok: boolean; username: string }>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ ok: boolean; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    }),
};
