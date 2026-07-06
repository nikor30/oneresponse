import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Measurement } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

function cssVar(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback;
  // Theme overrides hang off <body data-theme=…>, so resolve vars there —
  // documentElement only ever sees the :root (light) values.
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

// SmokePing-style latency + packet-loss visualization.
//
// What it draws, in z-order:
//   1. Grid + axes
//   2. Per-sample "loss bar" — vertical translucent stripe across the full
//      plot height when a sample had packet loss, colored by loss bucket
//   3. "Smoke" — stacked percentile bands per sample (p25-p75 darkest,
//      p10-p90, min-max lightest). Built from the 20 individual RTTs when
//      available; falls back to a single min-max band for bucketed data.
//   4. Median line connecting samples (thin green)
//   5. Median dot per sample, colored by packet-loss bucket
//   6. Stats footer (median / avg / min / max / now / sd) and loss legend

interface Props {
  measurements: Measurement[];
  from: number;
  to: number;
  probeCount: number;
  probeIntervalSec: number;
  title?: string;
}

// SmokePing-canonical loss color buckets. The discrete colors match the
// reference screenshot (0/blue/cyan/yellow/orange/magenta/red).
const LOSS_COLORS = [
  { lost: 0, color: '#00c000', label: '0' },
  { lost: 1, color: '#1f6feb', label: '1/20' },
  { lost: 2, color: '#00d4d4', label: '2/20' },
  { lost: 3, color: '#e6c200', label: '3/20' },
  { lost: 4, color: '#ff8800', label: '4/20' },
  { lost: 10, color: '#cc00cc', label: '10/20' },
  { lost: 19, color: '#cc0000', label: '19/20' },
];

function lossColor(lostCount: number, total: number): string {
  if (total <= 0 || !isFinite(lostCount)) return '#888';
  // Find the largest bucket whose threshold (scaled to `total`) is <= lostCount.
  const scale = total / 20;
  let chosen = LOSS_COLORS[0].color;
  for (const b of LOSS_COLORS) {
    if (lostCount >= b.lost * scale) chosen = b.color;
  }
  return chosen;
}

function formatMs(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v < 1) return `${(v * 1000).toFixed(0)} µs`;
  if (v < 10) return `${v.toFixed(2)} ms`;
  if (v < 100) return `${v.toFixed(1)} ms`;
  return `${Math.round(v)} ms`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export default function SmokePingGraph({
  measurements,
  from,
  to,
  probeCount,
  probeIntervalSec,
  title,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const { theme } = useTheme();

  // Responsive width
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setWidth(Math.max(320, containerRef.current.clientWidth));
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const height = 320;
  const margin = { top: 24, right: 16, bottom: 32, left: 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Stats computed once from raw data
  const stats = useMemo(() => computeStats(measurements), [measurements]);

  // Sort samples once
  const sorted = useMemo(
    () => [...measurements].sort((a, b) => a.timestamp - b.timestamp),
    [measurements],
  );

  // Y-axis upper bound: round up to a clean value above the observed max
  const yMax = useMemo(() => {
    let m = 0;
    for (const s of sorted) {
      const candidate = Math.max(s.latency_max ?? 0, ...(s.rtts ?? []));
      if (candidate > m) m = candidate;
    }
    if (m <= 0) m = 50;
    // Round up to a "nice" number
    const exp = Math.pow(10, Math.floor(Math.log10(m)));
    const norm = m / exp;
    let nice: number;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * exp * 1.1;
  }, [sorted]);

  // ---- Render to canvas + svg overlay ----
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

    // The plot interior stays white in both themes — the SmokePing smoke
    // bands are dark translucent grays that need a light background.
    // Text drawn outside the plot (title, ticks) follows the theme.
    const plotBg     = '#ffffff';
    const gridStroke = '#e5e7eb';
    const tickFill   = cssVar('--text-muted', '#64748b');
    const frameStroke= cssVar('--text-dim', '#94a3b8');
    const titleFill  = cssVar('--text', '#0f172a');

    const xScale = d3.scaleTime()
      .domain([new Date(from * 1000), new Date(to * 1000)])
      .range([margin.left, margin.left + plotW]);
    const yScale = d3.scaleLinear()
      .domain([0, yMax])
      .range([margin.top + plotH, margin.top]);

    // Plot background
    ctx.fillStyle = plotBg;
    ctx.fillRect(margin.left, margin.top, plotW, plotH);

    // Grid lines (y)
    const yTicks = yScale.ticks(6);
    ctx.strokeStyle = gridStroke;
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = tickFill;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach(t => {
      const y = yScale(t);
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatMs(t), margin.left - 6, y);
    });

    // Sample step (px). Use real time spacing rather than even distribution
    // so gaps in data are visible.
    const rangeSec = to - from;
    const approxStepPx = Math.max(1, plotW / Math.max(1, rangeSec / probeIntervalSec));
    const stripWidth = Math.max(1.2, Math.min(approxStepPx * 0.9, 8));

    // ---- Pass 1: loss bars (background) ----
    for (const m of sorted) {
      const total = m.probe_count ?? probeCount;
      const lossPct = m.loss_pct ?? 0;
      const lossCount = Math.round((lossPct / 100) * total);
      if (lossCount <= 0) continue;
      const x = xScale(new Date(m.timestamp * 1000));
      ctx.fillStyle = lossColor(lossCount, total);
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x - stripWidth / 2, margin.top, stripWidth, plotH);
    }
    ctx.globalAlpha = 1;

    // ---- Pass 2: smoke ----
    for (const m of sorted) {
      const x = xScale(new Date(m.timestamp * 1000));
      if (m.rtts && m.rtts.length >= 3) {
        const s = [...m.rtts].sort((a, b) => a - b);
        const pMin = s[0];
        const pMax = s[s.length - 1];
        const p10 = percentile(s, 0.10);
        const p25 = percentile(s, 0.25);
        const p75 = percentile(s, 0.75);
        const p90 = percentile(s, 0.90);

        // Min-max (lightest)
        ctx.fillStyle = 'rgba(70,70,70,0.18)';
        ctx.fillRect(x - stripWidth / 2, yScale(pMax), stripWidth, yScale(pMin) - yScale(pMax));
        // p10-p90
        ctx.fillStyle = 'rgba(50,50,50,0.30)';
        ctx.fillRect(x - stripWidth / 2, yScale(p90), stripWidth, yScale(p10) - yScale(p90));
        // p25-p75 (darkest)
        ctx.fillStyle = 'rgba(30,30,30,0.50)';
        ctx.fillRect(x - stripWidth / 2, yScale(p75), stripWidth, yScale(p25) - yScale(p75));
      } else if (m.latency_min != null && m.latency_max != null) {
        // Bucketed/no-rtts fallback: single min-max band
        const y1 = yScale(m.latency_max);
        const y2 = yScale(m.latency_min);
        ctx.fillStyle = 'rgba(40,40,40,0.35)';
        ctx.fillRect(x - stripWidth / 2, y1, stripWidth, y2 - y1);
      }
    }

    // ---- Pass 3: median line + colored dots ----
    ctx.strokeStyle = 'rgba(34,197,94,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (const m of sorted) {
      if (m.latency_avg == null) continue;
      const x = xScale(new Date(m.timestamp * 1000));
      const y = yScale(m.latency_avg);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (const m of sorted) {
      if (m.latency_avg == null) continue;
      const x = xScale(new Date(m.timestamp * 1000));
      const y = yScale(m.latency_avg);
      const total = m.probe_count ?? probeCount;
      const lostCount = Math.round(((m.loss_pct ?? 0) / 100) * total);
      ctx.fillStyle = lossColor(lostCount, total);
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Plot frame
    ctx.strokeStyle = frameStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    // Y-axis label
    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = tickFill;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Seconds (RTT)', 0, 0);
    ctx.restore();

    // Title
    if (title) {
      ctx.fillStyle = titleFill;
      ctx.font = '600 13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(title, margin.left + plotW / 2, 4);
    }

    // ---- X axis labels (SVG so dates stay crisp) ----
    const svg = d3.select(overlay);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const xAxisG = svg.append('g')
      .attr('transform', `translate(0,${margin.top + plotH})`);

    const tickCount = Math.max(4, Math.min(12, Math.floor(plotW / 90)));
    const xAxis = d3.axisBottom<Date>(xScale)
      .ticks(tickCount)
      .tickSize(4)
      .tickPadding(6);
    xAxisG.call(xAxis);
    xAxisG.selectAll('path,line').attr('stroke', frameStroke);
    xAxisG.selectAll('text').attr('fill', tickFill).attr('font-size', 11);
  }, [sorted, from, to, width, plotW, plotH, margin.left, margin.right, margin.top, margin.bottom, yMax, title, probeIntervalSec, probeCount, theme]);

  // Compute display loss legend
  const lossSwatches = LOSS_COLORS;
  const endLabel = new Date(to * 1000).toLocaleString();

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <div style={{ position: 'relative', width: '100%', height }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
        <svg ref={overlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        {sorted.length === 0 && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
            fontSize: 13,
          }}>
            No measurement data in this time range yet.
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <Stat label="median rtt" value={formatMs(stats.median)} />
          <Stat label="avg" value={formatMs(stats.avg)} />
          <Stat label="min" value={formatMs(stats.min)} />
          <Stat label="max" value={formatMs(stats.max)} />
          <Stat label="now" value={formatMs(stats.now)} />
          <Stat label="sd" value={formatMs(stats.sd)} />
          <Stat label="loss" value={`${stats.lossPct.toFixed(2)} %`} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>loss color:</span>
          {lossSwatches.map(b => (
            <span key={b.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                display: 'inline-block',
                width: 12, height: 12,
                background: b.color,
                border: '1px solid #cbd5e1',
                borderRadius: 2,
              }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.label}</span>
            </span>
          ))}
        </div>
        <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>
          probe: {probeCount} ICMP Echo Pings every {probeIntervalSec}s &nbsp;·&nbsp; end: {endLabel}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ color: '#64748b' }}>{label}:</span>{' '}
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{value}</span>
    </span>
  );
}

interface ComputedStats {
  median: number;
  avg: number;
  min: number;
  max: number;
  now: number;
  sd: number;
  lossPct: number;
}

function computeStats(measurements: Measurement[]): ComputedStats {
  if (measurements.length === 0) {
    return { median: NaN, avg: NaN, min: NaN, max: NaN, now: NaN, sd: 0, lossPct: 0 };
  }
  // Pool all RTTs we can find. If the dataset has individual rtts, use them
  // (matches SmokePing exactly). Otherwise use latency_avg/min/max.
  const allRtts: number[] = [];
  const avgs: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  let lossSum = 0;
  let lossCount = 0;
  for (const m of measurements) {
    if (m.rtts && m.rtts.length > 0) allRtts.push(...m.rtts);
    if (m.latency_avg != null) avgs.push(m.latency_avg);
    if (m.latency_min != null) min = Math.min(min, m.latency_min);
    if (m.latency_max != null) max = Math.max(max, m.latency_max);
    if (m.loss_pct != null) { lossSum += m.loss_pct; lossCount++; }
  }
  const pool = allRtts.length > 0 ? allRtts : avgs;
  const sortedPool = [...pool].sort((a, b) => a - b);
  const median = sortedPool.length > 0 ? percentile(sortedPool, 0.5) : NaN;
  const avg = pool.length > 0 ? pool.reduce((a, b) => a + b, 0) / pool.length : NaN;
  const sd = stddev(pool);
  // Use the most recent measurement's avg as "now"
  const lastWithAvg = [...measurements].reverse().find(m => m.latency_avg != null);
  const now = lastWithAvg?.latency_avg ?? NaN;
  const lossPct = lossCount > 0 ? lossSum / lossCount : 0;
  return {
    median,
    avg,
    min: isFinite(min) ? min : NaN,
    max: isFinite(max) ? max : NaN,
    now,
    sd,
    lossPct,
  };
}
