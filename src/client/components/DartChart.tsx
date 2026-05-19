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

// Latency → normalised radius (0 = center, 1 = edge).
// SLA threshold sits on the 0.7 ring, 3× threshold sits on the outer edge.
function latencyToRadius(latency: number, threshold: number): number {
  if (latency <= 0) return 0;
  if (latency <= threshold) {
    return 0.7 * (latency / threshold);
  }
  const over = Math.min(1, (latency - threshold) / (threshold * 2));
  return 0.7 + 0.3 * over;
}

export default function DartChart({ data, onTargetClick, selectedGroup }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

    // -----------------------------------------------------------------
    // SVG defs: filters and clip paths
    // -----------------------------------------------------------------
    const defs = svg.append('defs');

    // Strong drop shadow for visually separating segments
    const shadow = defs.append('filter')
      .attr('id', 'segment-shadow')
      .attr('x', '-20%').attr('y', '-20%')
      .attr('width', '140%').attr('height', '140%');
    shadow.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', 3);
    shadow.append('feOffset').attr('dx', 0).attr('dy', 1.5).attr('result', 'b');
    shadow.append('feComponentTransfer').append('feFuncA').attr('type', 'linear').attr('slope', 0.35);
    const sMerge = shadow.append('feMerge');
    sMerge.append('feMergeNode');
    sMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Soft glow for dots
    const glow = defs.append('filter')
      .attr('id', 'dot-glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', 2.2).attr('result', 'cb');
    const gMerge = glow.append('feMerge');
    gMerge.append('feMergeNode').attr('in', 'cb');
    gMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Subtle radial highlight (sheen) inside each zone — purely cosmetic,
    // gives the chart visual depth like the reference image
    const greenSheen = defs.append('radialGradient')
      .attr('id', 'green-sheen')
      .attr('cx', '50%').attr('cy', '40%').attr('r', '60%');
    greenSheen.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff').attr('stop-opacity', 0.18);
    greenSheen.append('stop').attr('offset', '100%').attr('stop-color', '#ffffff').attr('stop-opacity', 0);

    const redSheen = defs.append('radialGradient')
      .attr('id', 'red-sheen')
      .attr('cx', '50%').attr('cy', '30%').attr('r', '70%');
    redSheen.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff').attr('stop-opacity', 0.12);
    redSheen.append('stop').attr('offset', '100%').attr('stop-color', '#ffffff').attr('stop-opacity', 0);

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    const totalGroups = filteredData.length;
    const anglePerGroup = (2 * Math.PI) / totalGroups;

    // -----------------------------------------------------------------
    // Saturated zone fills — red outer disc, green inner disc.
    // Built per-segment with bright fills + white dividers for crisp
    // segregation between groups.
    // -----------------------------------------------------------------
    const RED  = '#d80027';
    const GREEN = '#00a644';
    const SLA_RING_R = radius * 0.7;

    // Outer red disc
    const arcOuter = d3.arc<{ s: number; e: number }>()
      .innerRadius(0)
      .outerRadius(radius)
      .startAngle(d => d.s)
      .endAngle(d => d.e);

    filteredData.forEach((_, idx) => {
      const s = idx * anglePerGroup;
      const e = s + anglePerGroup;
      g.append('path')
        .attr('d', arcOuter({ s, e })!)
        .attr('fill', RED)
        .attr('filter', 'url(#segment-shadow)');
    });

    // Red sheen overlay
    g.append('circle')
      .attr('r', radius)
      .attr('fill', 'url(#red-sheen)')
      .attr('pointer-events', 'none');

    // Inner green disc (covers everything inside SLA threshold)
    const arcInner = d3.arc<{ s: number; e: number }>()
      .innerRadius(0)
      .outerRadius(SLA_RING_R)
      .startAngle(d => d.s)
      .endAngle(d => d.e);

    filteredData.forEach((_, idx) => {
      const s = idx * anglePerGroup;
      const e = s + anglePerGroup;
      g.append('path')
        .attr('d', arcInner({ s, e })!)
        .attr('fill', GREEN);
    });

    // Green sheen overlay
    g.append('circle')
      .attr('r', SLA_RING_R)
      .attr('fill', 'url(#green-sheen)')
      .attr('pointer-events', 'none');

    // -----------------------------------------------------------------
    // White segment dividers (strong segregation)
    // -----------------------------------------------------------------
    filteredData.forEach((_, idx) => {
      const startAngle = idx * anglePerGroup - Math.PI / 2;
      g.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', Math.cos(startAngle) * radius)
        .attr('y2', Math.sin(startAngle) * radius)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0.95);
    });

    // -----------------------------------------------------------------
    // Concentric scale rings (white, low-opacity)
    // -----------------------------------------------------------------
    [0.2, 0.4, 0.55, 0.85].forEach(r => {
      g.append('circle')
        .attr('r', radius * r)
        .attr('fill', 'none')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 0.8)
        .attr('opacity', 0.45)
        .attr('stroke-dasharray', '2,4');
    });

    // Bold SLA threshold ring
    g.append('circle')
      .attr('r', SLA_RING_R)
      .attr('fill', 'none')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 3.5);
    g.append('circle')
      .attr('r', SLA_RING_R)
      .attr('fill', 'none')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 1)
      .attr('opacity', 0.55);

    // Outer ring
    g.append('circle')
      .attr('r', radius)
      .attr('fill', 'none')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 1)
      .attr('opacity', 0.4);

    // -----------------------------------------------------------------
    // Per-group axis labels + per-segment latency tick labels
    // -----------------------------------------------------------------
    filteredData.forEach((groupData, groupIdx) => {
      const startAngle = groupIdx * anglePerGroup - Math.PI / 2;
      const midAngle = startAngle + anglePerGroup / 2;

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

      // Small ms-tick labels along an off-axis line so they don't overlap
      // target dots in the segment
      const tickAngle = startAngle + anglePerGroup * 0.18;
      const threshold = groupData.group.sla_latency_ms;
      const ticks: { frac: number; ms: number; bold?: boolean }[] = [
        { frac: 0.35, ms: threshold * 0.5 },
        { frac: 0.7, ms: threshold, bold: true },
        { frac: 0.85, ms: threshold * 2 },
        { frac: 1.0, ms: threshold * 3 },
      ];
      const tcos = Math.cos(tickAngle), tsin = Math.sin(tickAngle);
      const perpX = Math.cos(tickAngle + Math.PI / 2), perpY = Math.sin(tickAngle + Math.PI / 2);

      ticks.forEach(({ frac, ms, bold }) => {
        const tx = tcos * radius * frac;
        const ty = tsin * radius * frac;
        const offX = tx + perpX * 12;
        const offY = ty + perpY * 12;
        const labelStr = `${formatMs(ms)}${bold ? ' (SLA)' : ''}`;
        const fontSize = bold ? 10 : 9;
        const approxW = labelStr.length * fontSize * 0.55;
        const lg = g.append('g').attr('transform', `translate(${offX},${offY})`).attr('pointer-events', 'none');
        lg.append('rect')
          .attr('x', -approxW / 2 - 3).attr('y', -fontSize / 2 - 2)
          .attr('width', approxW + 6).attr('height', fontSize + 4)
          .attr('rx', 3)
          .attr('fill', 'rgba(255,255,255,0.92)')
          .attr('stroke', bold ? '#0f172a' : 'transparent')
          .attr('stroke-width', bold ? 0.8 : 0);
        lg.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', fontSize)
          .attr('font-weight', bold ? 700 : 500)
          .attr('fill', '#0f172a')
          .text(labelStr);
      });
    });

    // -----------------------------------------------------------------
    // Bullseye (center) — prominent target marker
    // -----------------------------------------------------------------
    const bullseye = g.append('g').attr('class', 'bullseye').style('pointer-events', 'none');
    bullseye.append('circle').attr('r', 16).attr('fill', '#ffffff');
    bullseye.append('circle').attr('r', 16).attr('fill', 'none').attr('stroke', '#0f172a').attr('stroke-width', 1.4);
    bullseye.append('circle').attr('r', 10).attr('fill', '#0f172a');
    bullseye.append('circle').attr('r', 4.5).attr('fill', '#ffffff');
    bullseye.append('circle').attr('r', 1.6).attr('fill', '#0f172a');

    // -----------------------------------------------------------------
    // Targets — permanent drift line (lifetime min ↔ max) + current dot
    // -----------------------------------------------------------------
    filteredData.forEach((groupData, groupIdx) => {
      const startAngle = groupIdx * anglePerGroup - Math.PI / 2;
      const threshold = groupData.group.sla_latency_ms;

      const targets = groupData.targets;
      const targetAngleStep = anglePerGroup / (targets.length + 1);

      targets.forEach((target, tIdx) => {
        const angle = startAngle + targetAngleStep * (tIdx + 1);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // No data yet
        if (target.latency_avg == null) {
          const r = SLA_RING_R;
          g.append('circle')
            .attr('cx', cos * r).attr('cy', sin * r)
            .attr('r', 5)
            .attr('fill', '#ffffff')
            .attr('stroke', '#475569')
            .attr('stroke-dasharray', '2,2');
          return;
        }

        const isCompliant = (target.sla_score ?? 0) >= 70;
        const dotFill = isCompliant ? '#0a7e36' : '#a30019';
        const dotStroke = '#ffffff';

        // Permanent drift line: lifetime min → lifetime max.
        // Falls back to current min/max when lifetime data isn't available
        // (e.g. before the dashboard query has been deployed).
        const driftMin = target.latency_min_lifetime ?? target.latency_min ?? target.latency_avg;
        const driftMax = target.latency_max_lifetime ?? target.latency_max ?? target.latency_avg;
        if (driftMin != null && driftMax != null && driftMin !== driftMax) {
          const rMin = radius * latencyToRadius(driftMin, threshold);
          const rMax = radius * latencyToRadius(driftMax, threshold);

          // White outline so the drift line stays legible across the
          // green ↔ red boundary
          g.append('line')
            .attr('x1', cos * rMin).attr('y1', sin * rMin)
            .attr('x2', cos * rMax).attr('y2', sin * rMax)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 4)
            .attr('opacity', 0.95)
            .attr('stroke-linecap', 'round');
          g.append('line')
            .attr('x1', cos * rMin).attr('y1', sin * rMin)
            .attr('x2', cos * rMax).attr('y2', sin * rMax)
            .attr('stroke', '#0f172a')
            .attr('stroke-width', 1.8)
            .attr('stroke-linecap', 'round');

          // End caps — min (inward, lighter) and max (outward, darker)
          g.append('circle')
            .attr('cx', cos * rMin).attr('cy', sin * rMin)
            .attr('r', 3.2)
            .attr('fill', '#ffffff')
            .attr('stroke', '#0f172a')
            .attr('stroke-width', 1.2);
          g.append('circle')
            .attr('cx', cos * rMax).attr('cy', sin * rMax)
            .attr('r', 3.2)
            .attr('fill', '#0f172a')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.2);
        }

        // Current-value dot
        const currentR = radius * latencyToRadius(target.latency_avg, threshold);
        const dotX = cos * currentR;
        const dotY = sin * currentR;

        const dotGroup = g.append('g').attr('cursor', 'pointer');
        // Halo
        dotGroup.append('circle')
          .attr('cx', dotX).attr('cy', dotY)
          .attr('r', 11)
          .attr('fill', dotFill)
          .attr('opacity', 0.28);
        const dot = dotGroup.append('circle')
          .attr('cx', dotX).attr('cy', dotY)
          .attr('r', 6.5)
          .attr('fill', dotFill)
          .attr('stroke', dotStroke)
          .attr('stroke-width', 2)
          .attr('filter', 'url(#dot-glow)');

        // Floating label pill: name · current latency
        const labelDist = 14;
        const anchor = cos > 0.15 ? 'start' : cos < -0.15 ? 'end' : 'middle';
        const lg = dotGroup.append('g')
          .attr('transform', `translate(${dotX + cos * labelDist},${dotY + sin * labelDist})`)
          .style('pointer-events', 'none');
        const labelText = `${target.name} · ${formatMs(target.latency_avg)}`;
        const padX = 6, padY = 3, fontPx = 11;
        const approxW = labelText.length * fontPx * 0.58;
        const rectX = anchor === 'start' ? -padX
                    : anchor === 'end'   ? -approxW - padX
                                          : -approxW / 2 - padX;
        lg.append('rect')
          .attr('x', rectX)
          .attr('y', -fontPx / 2 - padY)
          .attr('width', approxW + padX * 2)
          .attr('height', fontPx + padY * 2)
          .attr('rx', 4)
          .attr('fill', 'rgba(255,255,255,0.94)')
          .attr('stroke', dotFill)
          .attr('stroke-width', 1);
        lg.append('text')
          .attr('text-anchor', anchor)
          .attr('dominant-baseline', 'middle')
          .attr('font-size', fontPx)
          .attr('font-weight', 600)
          .attr('fill', '#0f172a')
          .text(labelText);

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
          dot.attr('r', 6.5);
          setTooltip(null);
        });
        dotGroup.on('click', () => onTargetClick(target.id));
      });
    });

    // -----------------------------------------------------------------
    // Legend
    // -----------------------------------------------------------------
    const legend = svg.append('g').attr('transform', `translate(${size - 220}, ${size - 70})`);
    const legendItems: { color: string; label: string; shape: 'circle' | 'line' }[] = [
      { color: '#0a7e36', label: 'SLA compliant', shape: 'circle' },
      { color: '#a30019', label: 'SLA breached', shape: 'circle' },
      { color: '#0f172a', label: 'Min ↔ max latency drift', shape: 'line' },
    ];
    legendItems.forEach((it, i) => {
      const row = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
      if (it.shape === 'circle') {
        row.append('circle').attr('cx', 7).attr('cy', 7).attr('r', 5.5).attr('fill', it.color);
      } else {
        row.append('line').attr('x1', 0).attr('y1', 7).attr('x2', 14).attr('y2', 7)
          .attr('stroke', '#ffffff').attr('stroke-width', 4);
        row.append('line').attr('x1', 0).attr('y1', 7).attr('x2', 14).attr('y2', 7)
          .attr('stroke', it.color).attr('stroke-width', 1.8);
        row.append('circle').attr('cx', 0).attr('cy', 7).attr('r', 2.5).attr('fill', '#fff').attr('stroke', '#0f172a').attr('stroke-width', 1);
        row.append('circle').attr('cx', 14).attr('cy', 7).attr('r', 2.5).attr('fill', '#0f172a');
      }
      row.append('text')
        .attr('x', 22).attr('y', 11)
        .attr('font-size', 11)
        .attr('fill', '#334155')
        .text(it.label);
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

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}
