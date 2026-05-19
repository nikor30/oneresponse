const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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
  created_at: number;
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
  group: { id: string; name: string; sla_latency_ms: number; sla_jitter_ms: number; sla_loss_pct: number };
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

export interface Peer {
  id: string;
  name: string;
  url: string;
  direction: string;
  enabled: number;
  last_seen: number | null;
  created_at: number;
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

// API calls
export const api = {
  // Dashboard
  getDashboard: () => request<DashboardGroup[]>('/dashboard'),
  getDashboardAggregate: () => request<DashboardNode[]>('/dashboard/aggregate'),

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

  // API keys (for granting other oneresponse nodes / peers access to this node)
  getApiKeys: () => request<ApiKey[]>('/api-keys'),
  createApiKey: (name: string, permissions: 'read' | 'write' = 'read') =>
    request<ApiKeyWithSecret>('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, permissions }),
    }),
  deleteApiKey: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  // Instance-level settings (key/value), e.g. site_name
  getSettings: () => request<Record<string, string | null>>('/settings'),
  updateSettings: (patch: Record<string, string | null>) =>
    request<Record<string, string | null>>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
