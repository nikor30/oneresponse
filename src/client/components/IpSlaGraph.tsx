import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Measurement } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

// Multi-panel time-series view of the extended Cisco IP SLA (udp-jitter)
// datapoints. One shared time axis; each unit group (latency ms, jitter ms,
// packet counts, MOS, ICPIF) gets its own panel so no series ever borrows
// another's y-scale (no dual axes). Every series has a labeled toggle chip
// — identity is never carried by color alone — and a hover crosshair reads
// out the visible values at the nearest sample.

function cssVar(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback;
  // Theme overrides hang off <body data-theme=…>, so resolve vars there —
  // documentElement only ever sees the :root (light) values.
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

interface Props {
  measurements: Measurement[];
  from: number;
  to: number;
}

type PanelId = 'latency' | 'jitterp' | 'packets' | 'mos' | 'icpif';

interface PanelDef {
  id: PanelId;
  title: string;
  unit: 'ms' | 'pkts' | '';
}

// Direction is encoded consistently across panels: S→D is always cyan,
// D→S is always purple.
const GREEN  = '#22c55e';
const CYAN   = '#49afd9';
const PURPLE = '#b07ce8';
const YELLOW = '#e0a800';
const RED    = '#f45151';
const ORANGE = '#ff8800';

const PANELS: PanelDef[] = [
  { id: 'latency', title: 'Latency', unit: 'ms' },
  { id: 'jitterp', title: 'Jitter', unit: 'ms' },
  { id: 'packets', title: 'Packet events per poll', unit: 'pkts' },
  { id: 'mos',     title: 'MOS — voice quality (1–5)', unit: '' },
  { id: 'icpif',   title: 'ICPIF — impairment factor (lower is better)', unit: '' },
];

interface SeriesDef {
  key: keyof Measurement;
  label: string;
  color: string;
  panel: PanelId;
  // Optional min/max fields drawn as a translucent band behind the line.
  band?: [keyof Measurement, keyof Measurement];
}

const SERIES: SeriesDef[] = [
  { key: 'latency_avg', label: 'Round-trip', color: GREEN,  panel: 'latency', band: ['latency_min', 'latency_max'] },
  { key: 'ow_sd_avg',   label: 'One-way S→D', color: CYAN,   panel: 'latency', band: ['ow_sd_min', 'ow_sd_max'] },
  { key: 'ow_ds_avg',   label: 'One-way D→S', color: PURPLE, panel: 'latency', band: ['ow_ds_min', 'ow_ds_max'] },
  { key: 'jitter',      label: 'Jitter (both)', color: YELLOW, panel: 'jitterp' },
  { key: 'jitter_sd',   label: 'Jitter S→D',   color: CYAN,   panel: 'jitterp' },
  { key: 'jitter_ds',   label: 'Jitter D→S',   color: PURPLE, panel: 'jitterp' },
  { key: 'loss_sd',     label: 'Lost S→D',     color: CYAN,   panel: 'packets' },
  { key: 'loss_ds',     label: 'Lost D→S',     color: PURPLE, panel: 'packets' },
  { key: 'pkt_oos',     label: 'Out of sequence', color: YELLOW, panel: 'packets' },
  { key: 'pkt_mia',     label: 'Missing (MIA)',   color: RED,    panel: 'packets' },
  { key: 'pkt_late',    label: 'Late arrival',    color: ORANGE, panel: 'packets' },
  { key: 'mos',         label: 'MOS',   color: GREEN, panel: 'mos' },
  { key: 'icpif',       label: 'ICPIF', color: RED,   panel: 'icpif' },
];

const STORAGE_KEY = 'oneresponse.ipsla_series.v1';

function loadVisibility(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch { /* ignore */ }
  return {};
}

const PANEL_H = 108;
const PANEL_GAP = 30;
const MARGIN_LEFT = 58;
const MARGIN_RIGHT = 14;
const MARGIN_TOP = 8;
const AXIS_H = 30;

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null || !isFinite(v)) return '—';
  // Packet counters are whole numbers (bucketed rows may average, so
  // round rather than truncate); everything else gets sensible decimals.
  const n = unit === 'pkts'
    ? String(Math.round(v))
    : Math.abs(v) < 10 ? v.toFixed(2) : Math.abs(v) < 100 ? v.toFixed(1) : String(Math.round(v));
  return unit ? `${n} ${unit}` : n;
}

export default function IpSlaGraph({ measurements, from, to }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [visible, setVisible] = useState<Record<string, boolean>>(loadVisibility);
  const [hover, setHover] = useState<{ x: number; m: Measurement } | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setWidth(Math.max(320, containerRef.current.clientWidth));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const sorted = useMemo(
    () => [...measurements].sort((a, b) => a.timestamp - b.timestamp),
    [measurements],
  );

  // A series participates only if at least one sample carries it.
  const seriesWithData = useMemo(() => {
    const has = new Set<string>();
    for (const s of SERIES) {
      if (sorted.some(m => m[s.key] != null)) has.add(s.key as string);
    }
    return has;
  }, [sorted]);

  const isOn = (key: string) => visible[key] !== false; // default on

  const toggle = (key: string) => {
    setVisible(prev => {
      const next = { ...prev, [key]: !(prev[key] !== false) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Panels that end up in the plot: have ≥1 series with data AND visible.
  const activePanels = useMemo(
    () => PANELS.filter(p =>
      SERIES.some(s => s.panel === p.id && seriesWithData.has(s.key as string) && isOn(s.key as string))
    ),
    [seriesWithData, visible] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const height = MARGIN_TOP + activePanels.length * (PANEL_H + PANEL_GAP) + AXIS_H;

  const xScale = useMemo(
    () => d3.scaleTime()
      .domain([new Date(from * 1000), new Date(to * 1000)])
      .range([MARGIN_LEFT, width - MARGIN_RIGHT]),
    [from, to, width],
  );

  // ---- Canvas render ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotBg      = cssVar('--bg-card', '#ffffff');
    const gridStroke  = cssVar('--border', '#e5e7eb');
    const tickFill    = cssVar('--text-muted', '#64748b');
    const frameStroke = cssVar('--text-dim', '#94a3b8');
    const titleFill   = cssVar('--text', '#0f172a');
    const plotW = width - MARGIN_LEFT - MARGIN_RIGHT;

    const svg = d3.select(overlay);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    activePanels.forEach((panel, pi) => {
      const top = MARGIN_TOP + pi * (PANEL_H + PANEL_GAP) + PANEL_GAP - 10;
      const panelSeries = SERIES.filter(
        s => s.panel === panel.id && seriesWithData.has(s.key as string) && isOn(s.key as string)
      );

      // y-domain per panel. MOS is a fixed 1–5 scale; everything else
      // starts at 0 and rounds up to a "nice" max.
      let yMin = 0;
      let dataMax = 0;
      for (const s of panelSeries) {
        for (const m of sorted) {
          const v = m[s.key] as number | null;
          if (v != null && v > dataMax) dataMax = v;
          if (s.band) {
            const hi = m[s.band[1]] as number | null;
            if (hi != null && hi > dataMax) dataMax = hi;
          }
        }
      }
      let yMax: number;
      if (panel.id === 'mos') { yMin = 1; yMax = 5; }
      else {
        const target = dataMax <= 0 ? 1 : dataMax;
        const exp = Math.pow(10, Math.floor(Math.log10(target)));
        const norm = target / exp;
        yMax = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * exp * 1.08;
      }
      const yScale = d3.scaleLinear().domain([yMin, yMax]).range([top + PANEL_H, top]);

      // Panel background + frame
      ctx.fillStyle = plotBg;
      ctx.fillRect(MARGIN_LEFT, top, plotW, PANEL_H);

      // Grid + y tick labels
      const ticks = panel.id === 'mos' ? [1, 2, 3, 4, 5] : yScale.ticks(3);
      ctx.strokeStyle = gridStroke;
      ctx.lineWidth = 1;
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = tickFill;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const t of ticks) {
        const y = yScale(t);
        ctx.beginPath();
        ctx.moveTo(MARGIN_LEFT, y);
        ctx.lineTo(MARGIN_LEFT + plotW, y);
        ctx.stroke();
        ctx.fillText(String(t), MARGIN_LEFT - 5, y);
      }

      // Bands first (behind lines)
      for (const s of panelSeries) {
        if (!s.band) continue;
        ctx.fillStyle = s.color + '26'; // ~15% alpha
        ctx.beginPath();
        let inBand = false;
        // Upper edge forward, lower edge backward — one polygon per gap-free run.
        const runs: Measurement[][] = [];
        let cur: Measurement[] = [];
        for (const m of sorted) {
          const lo = m[s.band[0]] as number | null;
          const hi = m[s.band[1]] as number | null;
          if (lo != null && hi != null) cur.push(m);
          else if (cur.length) { runs.push(cur); cur = []; }
        }
        if (cur.length) runs.push(cur);
        for (const run of runs) {
          if (run.length < 2) continue;
          ctx.beginPath();
          inBand = false;
          for (const m of run) {
            const x = xScale(new Date(m.timestamp * 1000));
            const y = yScale(Math.min(m[s.band![1]] as number, yMax));
            if (!inBand) { ctx.moveTo(x, y); inBand = true; } else ctx.lineTo(x, y);
          }
          for (let i = run.length - 1; i >= 0; i--) {
            const m = run[i];
            const x = xScale(new Date(m.timestamp * 1000));
            ctx.lineTo(x, yScale(Math.max(m[s.band![0]] as number, yMin)));
          }
          ctx.closePath();
          ctx.fill();
        }
      }

      // Lines
      for (const s of panelSeries) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        let started = false;
        for (const m of sorted) {
          const v = m[s.key] as number | null;
          if (v == null) { started = false; continue; }
          const x = xScale(new Date(m.timestamp * 1000));
          const y = yScale(Math.max(yMin, Math.min(v, yMax)));
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Frame + title
      ctx.strokeStyle = frameStroke;
      ctx.globalAlpha = 0.55;
      ctx.strokeRect(MARGIN_LEFT, top, plotW, PANEL_H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = titleFill;
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(panel.title + (panel.unit ? ` (${panel.unit})` : ''), MARGIN_LEFT, top - 4);
    });

    // Shared time axis at the bottom
    if (activePanels.length > 0) {
      const axisY = MARGIN_TOP + activePanels.length * (PANEL_H + PANEL_GAP) - 10;
      const xAxisG = svg.append('g').attr('transform', `translate(0,${axisY})`);
      const tickCount = Math.max(4, Math.min(12, Math.floor(plotW / 90)));
      const xAxis = d3.axisBottom<Date>(xScale).ticks(tickCount).tickSize(4).tickPadding(6);
      xAxisG.call(xAxis);
      xAxisG.selectAll('path,line').attr('stroke', frameStroke);
      xAxisG.selectAll('text').attr('fill', tickFill).attr('font-size', 11);
    }
  }, [sorted, activePanels, seriesWithData, xScale, width, height, theme, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Hover crosshair ----
  const onMove = (e: React.MouseEvent) => {
    if (sorted.length === 0 || activePanels.length === 0) return setHover(null);
    const rect = containerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < MARGIN_LEFT || px > width - MARGIN_RIGHT) return setHover(null);
    // Nearest sample by time
    const t = (xScale.invert(px) as Date).getTime() / 1000;
    let best = sorted[0];
    let bestD = Infinity;
    for (const m of sorted) {
      const d = Math.abs(m.timestamp - t);
      if (d < bestD) { bestD = d; best = m; }
    }
    setHover({ x: xScale(new Date(best.timestamp * 1000)), m: best });
  };

  const hoverRows = hover
    ? SERIES.filter(s => seriesWithData.has(s.key as string) && isOn(s.key as string))
        .map(s => ({
          s,
          v: hover.m[s.key] as number | null,
          unit: PANELS.find(p => p.id === s.panel)?.unit || '',
        }))
    : [];

  const plotBottom = MARGIN_TOP + activePanels.length * (PANEL_H + PANEL_GAP) - 10;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {/* Series toggle chips, grouped by panel */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginBottom: 12 }}>
        {PANELS.map(p => {
          const chips = SERIES.filter(s => s.panel === p.id && seriesWithData.has(s.key as string));
          if (chips.length === 0) return null;
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {p.id === 'jitterp' ? 'Jitter' : p.id === 'packets' ? 'Packets' : p.id === 'latency' ? 'Latency' : p.title.split(' ')[0]}
              </span>
              {chips.map(s => {
                const on = isOn(s.key as string);
                return (
                  <button
                    key={s.key as string}
                    onClick={() => toggle(s.key as string)}
                    aria-pressed={on}
                    title={on ? 'Click to hide' : 'Click to show'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                      border: `1px solid ${on ? s.color : 'var(--border)'}`,
                      background: on ? 'var(--bg-card)' : 'transparent',
                      color: on ? 'var(--text)' : 'var(--text-dim)',
                      fontSize: 12, fontWeight: 600,
                      opacity: on ? 1 : 0.6,
                    }}
                  >
                    <span style={{
                      width: 14, height: 3, borderRadius: 2,
                      background: on ? s.color : 'transparent',
                      border: on ? 'none' : `1px solid ${s.color}`,
                    }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {activePanels.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
          {seriesWithData.size === 0
            ? 'No IP SLA metrics in this time range yet.'
            : 'All series hidden — enable one above.'}
        </div>
      ) : (
        <div
          style={{ position: 'relative', width: '100%', height }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
          <svg ref={overlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
          {hover && (
            <>
              <div style={{
                position: 'absolute', top: MARGIN_TOP + PANEL_GAP - 10, left: hover.x,
                width: 1, height: plotBottom - (MARGIN_TOP + PANEL_GAP - 10),
                background: 'var(--text-dim)', opacity: 0.65, pointerEvents: 'none',
              }} />
              <div style={{
                position: 'absolute',
                top: 8,
                left: Math.min(hover.x + 12, width - 230),
                background: 'var(--pill-bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-md)',
                padding: '8px 12px',
                fontSize: 12,
                pointerEvents: 'none',
                zIndex: 5,
                minWidth: 190,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>
                  {new Date(hover.m.timestamp * 1000).toLocaleString()}
                </div>
                {hoverRows.map(({ s, v, unit }) => (
                  <div key={s.key as string} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.7 }}>
                    <span style={{ width: 10, height: 3, borderRadius: 2, background: s.color }} />
                    <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text)' }}>{fmt(v, unit)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6 }}>
        One-way latency (S→D / D→S) requires NTP sync between the IP SLA source and responder —
        devices report nothing there when unsynced.
      </div>
    </div>
  );
}
