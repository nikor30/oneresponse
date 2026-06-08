import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { DashboardGroup, DashboardTarget } from '../api/client';
import DartChartTooltip from './DartChartTooltip';

interface Props {
  data: DashboardGroup[];
  onTargetClick: (targetId: string) => void;
  selectedGroup: string | null;
  showLabels?: boolean;
}

interface TooltipData {
  target: DashboardTarget;
  groupName: string;
  x: number;
  y: number;
}

interface VizRange {
  min: number;       // latency that maps to chart center
  threshold: number; // latency that maps to SLA ring (0.7 radius)
  max: number;       // latency that maps to chart edge
}

// Resolve per-group viz min/max with sensible fallbacks.
function vizRangeFor(g: { sla_latency_ms: number; viz_latency_min: number | null; viz_latency_max: number | null }): VizRange {
  const threshold = g.sla_latency_ms;
  const min = g.viz_latency_min != null ? g.viz_latency_min : 0;
  const max = g.viz_latency_max != null ? g.viz_latency_max : threshold * 3;
  return { min, threshold, max };
}

// Latency → normalised radius (0 = center, 1 = edge).
// SLA threshold always sits on the 0.7 ring. viz min sits at center,
// viz max sits at the edge.
function latencyToRadius(latency: number, r: VizRange): number {
  if (latency <= r.min) return 0;
  if (latency >= r.max) return 1;
  if (latency <= r.threshold) {
    const span = r.threshold - r.min;
    if (span <= 0) return 0.7;
    return 0.7 * ((latency - r.min) / span);
  }
  const span = r.max - r.threshold;
  if (span <= 0) return 0.7;
  return 0.7 + 0.3 * ((latency - r.threshold) / span);
}

export default function DartChart({ data, onTargetClick, selectedGroup, showLabels = true }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [size, setSize] = useState(800);

  // Responsive sizing — cap higher (1000) so two charts side-by-side on a
  // wide screen can each use ~half the viewport width comfortably.
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        setSize(Math.min(w, 1000));
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

    // Soft drop-shadow for label pills (makes translucent labels readable
    // against the saturated red zone)
    const labelShadow = defs.append('filter')
      .attr('id', 'label-shadow')
      .attr('x', '-30%').attr('y', '-30%')
      .attr('width', '160%').attr('height', '160%');
    labelShadow.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', 1.6);
    labelShadow.append('feOffset').attr('dx', 0).attr('dy', 1.2).attr('result', 'lo');
    labelShadow.append('feComponentTransfer')
      .append('feFuncA').attr('type', 'linear').attr('slope', 0.45);
    const lsMerge = labelShadow.append('feMerge');
    lsMerge.append('feMergeNode');
    lsMerge.append('feMergeNode').attr('in', 'SourceGraphic');

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
    const CYAN = '#06b6d4'; // Cisco IP SLA accent — distinguishes device-sourced points
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
    // Per-group axis labels + per-segment latency tick labels.
    // Group names are laid along a curved <textPath> so they hug the chart
    // rim (like the ResponseWatch reference). For segments on the lower
    // half we reverse the arc direction so text stays upright.
    // -----------------------------------------------------------------
    const groupLabelR = radius + 22;
    filteredData.forEach((groupData, groupIdx) => {
      const startAngle = groupIdx * anglePerGroup - Math.PI / 2;
      const midAngle = startAngle + anglePerGroup / 2;
      const arcSpan = anglePerGroup * 0.85;
      const aStart = midAngle - arcSpan / 2;
      const aEnd   = midAngle + arcSpan / 2;
      const flipped = Math.sin(midAngle) > 0; // lower half in SVG coords

      // For lower half we reverse the arc so the text reads upright.
      const [a1, a2, sweep] = flipped
        ? [aEnd, aStart, 0]
        : [aStart, aEnd, 1];
      const x1 = Math.cos(a1) * groupLabelR;
      const y1 = Math.sin(a1) * groupLabelR;
      const x2 = Math.cos(a2) * groupLabelR;
      const y2 = Math.sin(a2) * groupLabelR;
      const pathId = `group-arc-${groupIdx}`;
      defs.append('path')
        .attr('id', pathId)
        .attr('d', `M ${x1},${y1} A ${groupLabelR},${groupLabelR} 0 0 ${sweep} ${x2},${y2}`)
        .attr('fill', 'none');

      const textEl = g.append('text')
        .attr('font-size', 16)
        .attr('font-weight', 700)
        .style('fill', 'var(--text)')
        .style('letter-spacing', '0.3px');
      textEl.append('textPath')
        .attr('href', `#${pathId}`)
        .attr('startOffset', '50%')
        .attr('text-anchor', 'middle')
        .text(groupData.group.name);

      // Small ms-tick labels along an off-axis line so they don't overlap
      // target dots in the segment. We use d3's nice-number generator
      // across the viz range, then anchor each value to its true radius
      // via latencyToRadius. The SLA threshold is always included and
      // duplicate-valued ticks are collapsed so a min == threshold or
      // threshold == max range doesn't print the same number twice.
      const tickAngle = startAngle + anglePerGroup * 0.18;
      const vr = vizRangeFor(groupData.group);

      // Ask d3 for nice tick values separately on each side of the SLA
      // threshold so both the green zone (below SLA) and the red zone
      // (above SLA) get labels even when the overall range is very wide
      // (e.g. center=50, edge=6000 — natural ticks would all land in red).
      const candidates: { ms: number; frac: number; bold: boolean }[] = [];
      const greenScale = d3.scaleLinear().domain([vr.min, vr.threshold]);
      const redScale   = d3.scaleLinear().domain([vr.threshold, vr.max]);
      // Halved the tick density per zone — the chart was crowded before.
      for (const v of greenScale.ticks(2)) {
        if (v <= vr.min + 1e-6 || v >= vr.threshold - 1e-6) continue;
        candidates.push({ ms: v, frac: latencyToRadius(v, vr), bold: false });
      }
      for (const v of redScale.ticks(2)) {
        if (v <= vr.threshold + 1e-6 || v >= vr.max - 1e-6) continue;
        candidates.push({ ms: v, frac: latencyToRadius(v, vr), bold: false });
      }
      // Always pin the SLA threshold (at radius 0.7) and the edge (at 1.0)
      candidates.push({ ms: vr.threshold, frac: 0.7, bold: true });
      if (vr.max > vr.threshold + 1e-6) {
        candidates.push({ ms: vr.max, frac: 1.0, bold: false });
      }

      candidates.sort((a, b) => a.frac - b.frac);
      // Deduplicate: drop a tick if its ms label and its radius are both
      // close to the previous one. The bold (SLA) tick wins ties.
      const ticks: typeof candidates = [];
      for (const t of candidates) {
        const last = ticks[ticks.length - 1];
        if (last && Math.abs(last.ms - t.ms) < 0.5 && Math.abs(last.frac - t.frac) < 0.04) {
          if (t.bold) ticks[ticks.length - 1] = t;
          continue;
        }
        ticks.push(t);
      }

      const tcos = Math.cos(tickAngle), tsin = Math.sin(tickAngle);
      const perpX = Math.cos(tickAngle + Math.PI / 2), perpY = Math.sin(tickAngle + Math.PI / 2);

      // Rotation that makes each label "lean into the circle" — text reads
      // along the tangent at the spoke's circular position. Flip 180° on
      // the bottom half so it never appears upside down.
      let tickRotDeg = ((tickAngle + Math.PI / 2) * 180) / Math.PI;
      if (Math.sin(tickAngle) > 0) tickRotDeg += 180;
      // Normalise to (-180, 180] just to keep transforms tidy
      tickRotDeg = ((tickRotDeg + 180) % 360) - 180;

      ticks.forEach(({ frac, ms, bold }) => {
        const tx = tcos * radius * frac;
        const ty = tsin * radius * frac;
        const offX = tx + perpX * 12;
        const offY = ty + perpY * 12;
        const labelStr = `${formatMs(ms)}${bold ? ' (SLA)' : ''}`;
        const fontSize = bold ? 10 : 9;
        const approxW = labelStr.length * fontSize * 0.55;
        const lg = g.append('g')
          .attr('transform', `translate(${offX},${offY}) rotate(${tickRotDeg})`)
          .attr('pointer-events', 'none')
          .attr('filter', 'url(#label-shadow)');
        lg.append('rect')
          .attr('x', -approxW / 2 - 3).attr('y', -fontSize / 2 - 2)
          .attr('width', approxW + 6).attr('height', fontSize + 4)
          .attr('rx', 3)
          .style('fill', 'var(--pill-bg)')
          .style('stroke', bold ? 'var(--text-muted)' : 'transparent')
          .style('stroke-width', bold ? 0.7 : 0);
        lg.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', fontSize)
          .attr('font-weight', bold ? 700 : 500)
          .style('fill', 'var(--text)')
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
      const vrTargets = vizRangeFor(groupData.group);

      const targets = groupData.targets;
      const targetAngleStep = anglePerGroup / (targets.length + 1);

      targets.forEach((target, tIdx) => {
        const angle = startAngle + targetAngleStep * (tIdx + 1);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const isIpsla = target.probe_type === 'cisco-ipsla';

        // No data yet
        if (target.latency_avg == null) {
          const r = SLA_RING_R;
          if (isIpsla) {
            // Cyan ring marks this as a Cisco IP SLA point even before data.
            g.append('circle')
              .attr('cx', cos * r).attr('cy', sin * r)
              .attr('r', 8)
              .attr('fill', 'none')
              .attr('stroke', CYAN)
              .attr('stroke-width', 2);
          }
          g.append('circle')
            .attr('cx', cos * r).attr('cy', sin * r)
            .attr('r', 5)
            .attr('fill', '#ffffff')
            .attr('stroke', isIpsla ? CYAN : '#475569')
            .attr('stroke-dasharray', '2,2');
          return;
        }

        const isCompliant = (target.sla_score ?? 0) >= 70;
        const dotFill = isCompliant ? '#0a7e36' : '#a30019';
        const dotStroke = '#ffffff';

        // Permanent drift line: lifetime min → lifetime max.
        // Falls back to current min/max when lifetime data isn't available.
        const driftMin = target.latency_min_lifetime ?? target.latency_min ?? target.latency_avg;
        const driftMax = target.latency_max_lifetime ?? target.latency_max ?? target.latency_avg;
        if (driftMin != null && driftMax != null && driftMin !== driftMax) {
          const rMin = radius * latencyToRadius(driftMin, vrTargets);
          const rMax = radius * latencyToRadius(driftMax, vrTargets);

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
        const currentR = radius * latencyToRadius(target.latency_avg, vrTargets);
        const dotX = cos * currentR;
        const dotY = sin * currentR;

        const dotGroup = g.append('g');

        // Tooltip helpers — shared between dot and label hover handlers
        const showTip = (event: MouseEvent) => {
          const rect = svgRef.current!.getBoundingClientRect();
          setTooltip({
            target,
            groupName: groupData.group.name,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        };
        const hideTip = () => setTooltip(null);

        // Halo — non-interactive
        dotGroup.append('circle')
          .attr('cx', dotX).attr('cy', dotY)
          .attr('r', 11)
          .attr('fill', dotFill)
          .attr('opacity', 0.14)
          .style('pointer-events', 'none');
        // Cisco IP SLA marker — a cyan ring around the dot so device-sourced
        // points are instantly distinguishable from local ICMP probes.
        if (isIpsla) {
          dotGroup.append('circle')
            .attr('cx', dotX).attr('cy', dotY)
            .attr('r', 10.5)
            .attr('fill', 'none')
            .attr('stroke', CYAN)
            .attr('stroke-width', 2.2)
            .attr('opacity', 0.95)
            .style('pointer-events', 'none');
        }
        // Translucent dot — 50% opacity status indicator; hover shows
        // tooltip but click does nothing (labels are the click target).
        const dot = dotGroup.append('circle')
          .attr('cx', dotX).attr('cy', dotY)
          .attr('r', 6.5)
          .attr('fill', dotFill)
          .attr('stroke', dotStroke)
          .attr('stroke-width', 2)
          .attr('opacity', 0.5)
          .attr('filter', 'url(#dot-glow)');
        dot.on('mouseover', (event: MouseEvent) => { dot.attr('r', 8); showTip(event); });
        dot.on('mouseout', () => { dot.attr('r', 6.5); hideTip(); });

        if (showLabels) {
          // Floating label pill — primary click target (bigger than the dot)
          const labelDist = 14;
          const anchor = cos > 0.15 ? 'start' : cos < -0.15 ? 'end' : 'middle';
          const lg = dotGroup.append('g')
            .attr('transform', `translate(${dotX + cos * labelDist},${dotY + sin * labelDist})`)
            .style('cursor', 'pointer')
            .attr('filter', 'url(#label-shadow)');
          const labelText = `${target.name} · ${formatMs(target.latency_avg)}`;
          const padX = 6, padY = 3, fontPx = 11;
          const approxW = labelText.length * fontPx * 0.58;
          const rectX = anchor === 'start' ? -padX
                      : anchor === 'end'   ? -approxW - padX
                                            : -approxW / 2 - padX;
          const labelRect = lg.append('rect')
            .attr('x', rectX)
            .attr('y', -fontPx / 2 - padY)
            .attr('width', approxW + padX * 2)
            .attr('height', fontPx + padY * 2)
            .attr('rx', 4)
            .style('fill', 'var(--pill-bg)')
            .style('stroke', dotFill)
            .style('stroke-width', '0.8px')
            .style('stroke-opacity', '0.6')
            .style('opacity', '0.92');
          lg.append('text')
            .attr('text-anchor', anchor)
            .attr('dominant-baseline', 'middle')
            .attr('font-size', fontPx)
            .attr('font-weight', 600)
            .style('fill', 'var(--text)')
            .text(labelText);

          lg.on('mouseover', (event: MouseEvent) => {
            labelRect.style('opacity', '1').style('stroke-width', '1.6px').style('stroke-opacity', '1');
            dot.attr('r', 8);
            showTip(event);
          });
          lg.on('mouseout', () => {
            labelRect.style('opacity', '0.92').style('stroke-width', '0.8px').style('stroke-opacity', '0.6');
            dot.attr('r', 6.5);
            hideTip();
          });
          lg.on('click', () => { hideTip(); onTargetClick(target.id); });
        } else {
          // Labels hidden — fall back to dot as click target so the user
          // can still drill in.
          dot.style('cursor', 'pointer');
          dot.on('click', () => { hideTip(); onTargetClick(target.id); });
        }
      });
    });

    // -----------------------------------------------------------------
    // Legend
    // -----------------------------------------------------------------
    const legend = svg.append('g').attr('transform', `translate(${size - 220}, ${size - 88})`);
    const legendItems: { color: string; label: string; shape: 'circle' | 'line' | 'ring' }[] = [
      { color: '#0a7e36', label: 'SLA compliant', shape: 'circle' },
      { color: '#a30019', label: 'SLA breached', shape: 'circle' },
      { color: CYAN, label: 'Cisco IP SLA', shape: 'ring' },
      { color: '#0f172a', label: 'Min ↔ max latency drift', shape: 'line' },
    ];
    legendItems.forEach((it, i) => {
      const row = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
      if (it.shape === 'circle') {
        row.append('circle').attr('cx', 7).attr('cy', 7).attr('r', 5.5).attr('fill', it.color);
      } else if (it.shape === 'ring') {
        // Filled dot wrapped in the cyan IP SLA ring, mirroring the chart.
        row.append('circle').attr('cx', 7).attr('cy', 7).attr('r', 6.5)
          .attr('fill', 'none').attr('stroke', it.color).attr('stroke-width', 2);
        row.append('circle').attr('cx', 7).attr('cy', 7).attr('r', 3).attr('fill', 'var(--text-muted)');
      } else {
        // Drift legend swatch — use theme variables so the dark dot at the
        // end remains visible against the dark card background.
        row.append('line').attr('x1', 0).attr('y1', 7).attr('x2', 14).attr('y2', 7)
          .style('stroke', 'var(--bg-card)').attr('stroke-width', 4);
        row.append('line').attr('x1', 0).attr('y1', 7).attr('x2', 14).attr('y2', 7)
          .style('stroke', 'var(--text)').attr('stroke-width', 1.8);
        row.append('circle').attr('cx', 0).attr('cy', 7).attr('r', 2.5)
          .style('fill', 'var(--bg-card)').style('stroke', 'var(--text)').attr('stroke-width', 1);
        row.append('circle').attr('cx', 14).attr('cy', 7).attr('r', 2.5)
          .style('fill', 'var(--text)');
      }
      row.append('text')
        .attr('x', 22).attr('y', 11)
        .attr('font-size', 11)
        .style('fill', 'var(--text-muted)')
        .text(it.label);
    });
  }, [data, size, selectedGroup, onTargetClick]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 1000,
        margin: '0 auto',
        background: 'var(--chart-bg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-md)',
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
