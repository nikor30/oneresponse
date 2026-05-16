import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { DashboardGroup, DashboardTarget } from '../api/client';
import DartChartTooltip from './DartChartTooltip';

interface Props {
  data: DashboardGroup[];
  onTargetClick: (targetId: string) => void;
  selectedGroup: string | null;
}

interface TooltipData {
  target: DashboardTarget;
  groupName: string;
  x: number;
  y: number;
}

interface PeakRecord {
  highLatency: number;
  highTs: number;
  lowLatency: number;
  lowTs: number;
}

// Peaks decay after this many ms — drift markers fade after this period
const PEAK_HOLD_MS = 5 * 60 * 1000; // 5 minutes

// Latency → normalised radius (0 = center, 1 = edge).
// Anchored so SLA threshold sits on the 0.7 ring (matches the existing
// "SLA compliant" green zone), and 3× threshold sits on the outer edge.
function latencyToRadius(latency: number, threshold: number): number {
  if (latency <= 0) return 0;
  if (latency <= threshold) {
    return 0.7 * (latency / threshold);
  }
  // Above threshold: 0.7 → 1.0 as latency goes threshold → 3×threshold
  const over = Math.min(1, (latency - threshold) / (threshold * 2));
  return 0.7 + 0.3 * over;
}

export default function DartChart({ data, onTargetClick, selectedGroup }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<Map<string, PeakRecord>>(new Map());
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [size, setSize] = useState(720);

  // Responsive sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        setSize(Math.min(w, 820));
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const filteredData = selectedGroup
      ? data.filter(d => d.group.id === selectedGroup)
      : data;

    if (filteredData.length === 0) return;

    const margin = 70;
    const radius = (size - margin * 2) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const now = Date.now();

    // Update peak-hold map: keep worst & best latency per target for PEAK_HOLD_MS
    filteredData.forEach(gd => {
      gd.targets.forEach(t => {
        if (t.latency_avg == null) return;
        const prev = peaksRef.current.get(t.id);
        const current = t.latency_avg;
        if (!prev) {
          peaksRef.current.set(t.id, {
            highLatency: current,
            highTs: now,
            lowLatency: current,
            lowTs: now,
          });
          return;
        }
        const next: PeakRecord = { ...prev };
        // High watermark
        if (current >= prev.highLatency || now - prev.highTs > PEAK_HOLD_MS) {
          next.highLatency = current;
          next.highTs = now;
        }
        // Low watermark
        if (current <= prev.lowLatency || now - prev.lowTs > PEAK_HOLD_MS) {
          next.lowLatency = current;
          next.lowTs = now;
        }
        peaksRef.current.set(t.id, next);
      });
    });

    // ---------------------------------------------------------------
    // SVG defs: filters & gradients for the modern look
    // ---------------------------------------------------------------
    const defs = svg.append('defs');

    // Drop shadow for group sectors
    const shadow = defs.append('filter')
      .attr('id', 'group-shadow')
      .attr('x', '-20%').attr('y', '-20%')
      .attr('width', '140%').attr('height', '140%');
    shadow.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', 4);
    shadow.append('feOffset').attr('dx', 0).attr('dy', 2).attr('result', 'offsetblur');
    const sMerge = shadow.append('feMerge');
    sMerge.append('feMergeNode');
    sMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Soft inner glow for dots
    const glow = defs.append('filter')
      .attr('id', 'dot-glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', 2.5).attr('result', 'coloredBlur');
    const gMerge = glow.append('feMerge');
    gMerge.append('feMergeNode').attr('in', 'coloredBlur');
    gMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Radial gradient — green inner, red outer
    const grad = defs.append('radialGradient')
      .attr('id', 'sla-gradient')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#22c55e').attr('stop-opacity', 0.25);
    grad.append('stop').attr('offset', '60%').attr('stop-color', '#22c55e').attr('stop-opacity', 0.18);
    grad.append('stop').attr('offset', '70%').attr('stop-color', '#f59e0b').attr('stop-opacity', 0.15);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#ef4444').attr('stop-opacity', 0.20);

    // ---------------------------------------------------------------
    // Root group
    // ---------------------------------------------------------------
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    const totalGroups = filteredData.length;
    const anglePerGroup = (2 * Math.PI) / totalGroups;

    // ---------------------------------------------------------------
    // Background: filled circle with gradient
    // ---------------------------------------------------------------
    g.append('circle')
      .attr('r', radius)
      .attr('fill', 'url(#sla-gradient)');

    // ---------------------------------------------------------------
    // Per-group sector backgrounds with subtle alternating tint + shadow
    // (gives optical group separation)
    // ---------------------------------------------------------------
    const arcGen = d3.arc<{ start: number; end: number }>()
      .innerRadius(0)
      .outerRadius(radius)
      .startAngle(d => d.start)
      .endAngle(d => d.end);

    filteredData.forEach((groupData, groupIdx) => {
      // d3.arc uses 0 = up (12 o'clock); we want our segment angles too.
      // We compute start/end angles in d3-convention (clockwise from top).
      const startAngleD3 = groupIdx * anglePerGroup;
      const endAngleD3 = startAngleD3 + anglePerGroup;

      // Alternating tint
      const tint = groupIdx % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
      g.append('path')
        .attr('d', arcGen({ start: startAngleD3, end: endAngleD3 })!)
        .attr('fill', tint)
        .attr('filter', 'url(#group-shadow)')
        .attr('pointer-events', 'none');
    });

    // ---------------------------------------------------------------
    // Concentric scale rings
    // ---------------------------------------------------------------
    const ringFractions = [0.2, 0.4, 0.6, 0.7, 0.85, 1.0];
    ringFractions.forEach(r => {
      g.append('circle')
        .attr('r', radius * r)
        .attr('fill', 'none')
        .attr('stroke', r === 0.7 ? '#1f2937' : '#94a3b8')
        .attr('stroke-width', r === 0.7 ? 1.5 : 0.6)
        .attr('stroke-dasharray', r === 0.7 ? 'none' : '3,4')
        .attr('opacity', r === 0.7 ? 0.9 : 0.55);
    });

    // ---------------------------------------------------------------
    // Bullseye (zero-latency target marker) — prominent central icon
    // ---------------------------------------------------------------
    const bullseye = g.append('g').attr('class', 'bullseye').style('pointer-events', 'none');
    bullseye.append('circle').attr('r', 14).attr('fill', '#fff').attr('stroke', '#0f172a').attr('stroke-width', 1.5);
    bullseye.append('circle').attr('r', 9).attr('fill', '#0f172a').attr('opacity', 0.9);
    bullseye.append('circle').attr('r', 4.5).attr('fill', '#f43f5e');
    // crosshairs
    [[-18, 0, -8, 0], [8, 0, 18, 0], [0, -18, 0, -8], [0, 8, 0, 18]].forEach(([x1, y1, x2, y2]) => {
      bullseye.append('line')
        .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2)
        .attr('stroke', '#0f172a')
        .attr('stroke-width', 1.2)
        .attr('opacity', 0.7);
    });
    bullseye.append('text')
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .attr('fill', '#0f172a')
      .text('0 ms · 100% SLA');

    // ---------------------------------------------------------------
    // Per-group axis: dividers, labels, latency scale ms-tick labels
    // ---------------------------------------------------------------
    filteredData.forEach((groupData, groupIdx) => {
      const startAngle = groupIdx * anglePerGroup - Math.PI / 2;
      const endAngle = startAngle + anglePerGroup;
      const midAngle = (startAngle + endAngle) / 2;

      // Segment divider line
      g.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', Math.cos(startAngle) * radius)
        .attr('y2', Math.sin(startAngle) * radius)
        .attr('stroke', '#cbd5e1')
        .attr('stroke-width', 1);

      // Group label at edge
      const labelR = radius + 28;
      const labelX = Math.cos(midAngle) * labelR;
      const labelY = Math.sin(midAngle) * labelR;
      const labelDeg = (midAngle * 180) / Math.PI;
      g.append('text')
        .attr('x', labelX).attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('transform', `rotate(${labelDeg > 90 || labelDeg < -90 ? labelDeg + 180 : labelDeg}, ${labelX}, ${labelY})`)
        .attr('font-size', 13)
        .attr('font-weight', 700)
        .attr('fill', '#0f172a')
        .text(groupData.group.name);

      // Latency scale ticks along an axis offset from mid-angle so they
      // don't overlap target dots (which are distributed in the segment).
      const tickAngle = startAngle + anglePerGroup * 0.18;
      const threshold = groupData.group.sla_latency_ms;
      const ticks: { frac: number; ms: number; bold?: boolean }[] = [
        { frac: 0.2, ms: threshold * 0.2 },
        { frac: 0.4, ms: threshold * 0.4 },
        { frac: 0.6, ms: threshold * 0.6 },
        { frac: 0.7, ms: threshold, bold: true },             // SLA threshold
        { frac: 0.85, ms: threshold * 2 },                    // 2× threshold
        { frac: 1.0, ms: threshold * 3 },                     // 3× threshold (edge)
      ];

      const tickCos = Math.cos(tickAngle);
      const tickSin = Math.sin(tickAngle);
      const perpDx = Math.cos(tickAngle + Math.PI / 2);
      const perpDy = Math.sin(tickAngle + Math.PI / 2);

      ticks.forEach(({ frac, ms, bold }) => {
        const tx = tickCos * radius * frac;
        const ty = tickSin * radius * frac;
        // small tick mark perpendicular to the axis
        g.append('line')
          .attr('x1', tx - perpDx * 3).attr('y1', ty - perpDy * 3)
          .attr('x2', tx + perpDx * 3).attr('y2', ty + perpDy * 3)
          .attr('stroke', bold ? '#0f172a' : '#475569')
          .attr('stroke-width', bold ? 1.3 : 0.8);

        // tick label — small pill so it stays legible over rings
        const offX = tx + perpDx * 12;
        const offY = ty + perpDy * 12;
        const labelStr = `${formatMs(ms)}${bold ? ' (SLA)' : ''}`;
        const fontSize = bold ? 10 : 9;
        const approxW = labelStr.length * fontSize * 0.55;
        const lg = g.append('g').attr('transform', `translate(${offX},${offY})`);
        lg.append('rect')
          .attr('x', -approxW / 2 - 3).attr('y', -fontSize / 2 - 2)
          .attr('width', approxW + 6).attr('height', fontSize + 4)
          .attr('rx', 3)
          .attr('fill', 'rgba(255,255,255,0.85)');
        lg.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', fontSize)
          .attr('font-weight', bold ? 700 : 500)
          .attr('fill', bold ? '#0f172a' : '#475569')
          .text(labelStr);
      });
    });

    // ---------------------------------------------------------------
    // Targets — drift line (with peak-hold), dot, floating label
    // ---------------------------------------------------------------
    filteredData.forEach((groupData, groupIdx) => {
      const startAngle = groupIdx * anglePerGroup - Math.PI / 2;
      const endAngle = startAngle + anglePerGroup;
      const threshold = groupData.group.sla_latency_ms;

      const targets = groupData.targets;
      const targetAngleStep = anglePerGroup / (targets.length + 1);

      targets.forEach((target, tIdx) => {
        const angle = startAngle + targetAngleStep * (tIdx + 1);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // No data yet — render a faint hollow dot at the SLA ring
        if (target.latency_avg == null) {
          const r = radius * 0.7;
          g.append('circle')
            .attr('cx', cos * r).attr('cy', sin * r)
            .attr('r', 5)
            .attr('fill', '#fff')
            .attr('stroke', '#9ca3af')
            .attr('stroke-dasharray', '2,2');
          return;
        }

        const currentRadius = radius * latencyToRadius(target.latency_avg, threshold);
        const dotX = cos * currentRadius;
        const dotY = sin * currentRadius;

        // -----------------------------------------------------------
        // Drift line (min → max) using current measurement min/max
        // -----------------------------------------------------------
        if (target.latency_min != null && target.latency_max != null) {
          const rMin = radius * latencyToRadius(target.latency_min, threshold);
          const rMax = radius * latencyToRadius(target.latency_max, threshold);
          g.append('line')
            .attr('x1', cos * rMin).attr('y1', sin * rMin)
            .attr('x2', cos * rMax).attr('y2', sin * rMax)
            .attr('stroke', (target.sla_score ?? 0) >= 70 ? '#16a34a' : '#dc2626')
            .attr('stroke-width', 2)
            .attr('opacity', 0.55)
            .attr('stroke-linecap', 'round');
        }

        // -----------------------------------------------------------
        // Peak-hold drift: persistent low/high watermarks (decay 5min)
        // -----------------------------------------------------------
        const peak = peaksRef.current.get(target.id);
        if (peak && (peak.highLatency !== peak.lowLatency)) {
          const peakHi = radius * latencyToRadius(peak.highLatency, threshold);
          const peakLo = radius * latencyToRadius(peak.lowLatency, threshold);

          // Faint line spanning the held peaks (this is the "drift trail")
          g.append('line')
            .attr('x1', cos * peakLo).attr('y1', sin * peakLo)
            .attr('x2', cos * peakHi).attr('y2', sin * peakHi)
            .attr('stroke', '#ef4444')
            .attr('stroke-width', 1.2)
            .attr('opacity', 0.35)
            .attr('stroke-dasharray', '3,3');

          // High-water marker — small filled triangle pointing outward
          const triHi = makeTriangle(cos * peakHi, sin * peakHi, angle, 5, true);
          g.append('polygon')
            .attr('points', triHi)
            .attr('fill', '#dc2626')
            .attr('opacity', Math.max(0.3, 1 - (now - peak.highTs) / PEAK_HOLD_MS));

          // Low-water marker — pointing inward
          const triLo = makeTriangle(cos * peakLo, sin * peakLo, angle, 5, false);
          g.append('polygon')
            .attr('points', triLo)
            .attr('fill', '#16a34a')
            .attr('opacity', Math.max(0.3, 1 - (now - peak.lowTs) / PEAK_HOLD_MS));
        }

        // -----------------------------------------------------------
        // Current-value dot
        // -----------------------------------------------------------
        const isCompliant = (target.sla_score ?? 0) >= 70;
        const fill = isCompliant ? '#16a34a' : '#dc2626';

        const dotGroup = g.append('g').attr('cursor', 'pointer');

        // Halo
        dotGroup.append('circle')
          .attr('cx', dotX).attr('cy', dotY)
          .attr('r', 10)
          .attr('fill', fill)
          .attr('opacity', 0.18);

        const dot = dotGroup.append('circle')
          .attr('cx', dotX).attr('cy', dotY)
          .attr('r', 6)
          .attr('fill', fill)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)
          .attr('filter', 'url(#dot-glow)');

        // -----------------------------------------------------------
        // Floating label — name + latency near the dot, biased outward
        // so it doesn't cover the ring
        // -----------------------------------------------------------
        const labelDist = 14;
        const labelOutX = dotX + cos * labelDist;
        const labelOutY = dotY + sin * labelDist;
        // Choose anchor based on which side of the chart we're on
        const anchor = cos > 0.15 ? 'start' : cos < -0.15 ? 'end' : 'middle';
        const labelGroup = dotGroup.append('g')
          .attr('transform', `translate(${labelOutX},${labelOutY})`)
          .style('pointer-events', 'none');

        // Pill background for readability
        const labelText = `${target.name} · ${formatMs(target.latency_avg)}`;
        const padX = 6;
        const padY = 3;
        const fontPx = 11;
        // approximate text width
        const approxW = labelText.length * fontPx * 0.58;

        let rectX = 0;
        if (anchor === 'start') rectX = -padX;
        else if (anchor === 'end') rectX = -approxW - padX;
        else rectX = -approxW / 2 - padX;

        labelGroup.append('rect')
          .attr('x', rectX)
          .attr('y', -fontPx / 2 - padY)
          .attr('width', approxW + padX * 2)
          .attr('height', fontPx + padY * 2)
          .attr('rx', 4)
          .attr('fill', 'rgba(255,255,255,0.92)')
          .attr('stroke', isCompliant ? '#16a34a' : '#dc2626')
          .attr('stroke-width', 1);

        labelGroup.append('text')
          .attr('text-anchor', anchor)
          .attr('dominant-baseline', 'middle')
          .attr('font-size', fontPx)
          .attr('font-weight', 600)
          .attr('fill', '#0f172a')
          .text(labelText);

        // -----------------------------------------------------------
        // Interactions
        // -----------------------------------------------------------
        dotGroup.on('mouseover', (event: MouseEvent) => {
          dot.attr('r', 8);
          const rect = svgRef.current!.getBoundingClientRect();
          setTooltip({
            target,
            groupName: groupData.group.name,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        });
        dotGroup.on('mouseout', () => {
          dot.attr('r', 6);
          setTooltip(null);
        });
        dotGroup.on('click', () => onTargetClick(target.id));
      });
    });

    // ---------------------------------------------------------------
    // Legend
    // ---------------------------------------------------------------
    const legend = svg.append('g').attr('transform', `translate(${size - 180}, ${size - 78})`);
    const legendItems: { color: string; label: string; shape?: 'circle' | 'tri-up' | 'tri-down' }[] = [
      { color: '#16a34a', label: 'SLA compliant', shape: 'circle' },
      { color: '#dc2626', label: 'SLA breached', shape: 'circle' },
      { color: '#dc2626', label: 'Recent peak high', shape: 'tri-up' },
      { color: '#16a34a', label: 'Recent peak low', shape: 'tri-down' },
    ];
    legendItems.forEach((item, i) => {
      const row = legend.append('g').attr('transform', `translate(0, ${i * 16})`);
      if (item.shape === 'circle') {
        row.append('circle').attr('cx', 6).attr('cy', 6).attr('r', 5).attr('fill', item.color);
      } else if (item.shape === 'tri-up') {
        row.append('polygon').attr('points', '1,11 11,11 6,1').attr('fill', item.color);
      } else if (item.shape === 'tri-down') {
        row.append('polygon').attr('points', '1,1 11,1 6,11').attr('fill', item.color);
      }
      row.append('text')
        .attr('x', 18).attr('y', 9)
        .attr('font-size', 11)
        .attr('fill', '#334155')
        .text(item.label);
    });

  }, [data, size, selectedGroup, onTargetClick]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 820,
        margin: '0 auto',
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(15, 23, 42, 0.08)',
        padding: 16,
      }}
    >
      <svg ref={svgRef} width={size} height={size} style={{ display: 'block', margin: '0 auto' }} />
      {tooltip && (
        <DartChartTooltip
          target={tooltip.target}
          groupName={tooltip.groupName}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}
    </div>
  );
}

// --- helpers -----------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

// Build a triangle polygon at (x,y) oriented along `angle` (radial direction).
// `outward = true` → tip points away from center; `false` → toward center.
function makeTriangle(x: number, y: number, angle: number, sz: number, outward: boolean): string {
  const dir = outward ? 1 : -1;
  // tip along radial direction
  const tipX = x + Math.cos(angle) * sz * dir;
  const tipY = y + Math.sin(angle) * sz * dir;
  // base perpendicular to radial direction
  const perp = angle + Math.PI / 2;
  const baseX1 = x - Math.cos(perp) * sz * 0.7 - Math.cos(angle) * sz * 0.3 * dir;
  const baseY1 = y - Math.sin(perp) * sz * 0.7 - Math.sin(angle) * sz * 0.3 * dir;
  const baseX2 = x + Math.cos(perp) * sz * 0.7 - Math.cos(angle) * sz * 0.3 * dir;
  const baseY2 = y + Math.sin(perp) * sz * 0.7 - Math.sin(angle) * sz * 0.3 * dir;
  return `${tipX},${tipY} ${baseX1},${baseY1} ${baseX2},${baseY2}`;
}
