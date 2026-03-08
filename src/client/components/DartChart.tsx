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

export default function DartChart({ data, onTargetClick, selectedGroup }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [size, setSize] = useState(600);

  // Responsive sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        setSize(Math.min(w, 700));
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

    const margin = 60;
    const radius = (size - margin * 2) / 2;
    const cx = size / 2;
    const cy = size / 2;

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // Count total segments (groups)
    const totalGroups = filteredData.length;
    const anglePerGroup = (2 * Math.PI) / totalGroups;

    // Draw concentric rings for SLA zones
    const rings = [0.2, 0.4, 0.6, 0.8, 1.0];

    // Red zone (outer) — SLA breached
    g.append('circle')
      .attr('r', radius)
      .attr('fill', '#dc3545')
      .attr('opacity', 0.15);

    // Green zone (inner ~70% of radius) — SLA compliant
    g.append('circle')
      .attr('r', radius * 0.7)
      .attr('fill', '#28a745')
      .attr('opacity', 0.2);

    // Ring lines
    for (const r of rings) {
      g.append('circle')
        .attr('r', radius * r)
        .attr('fill', 'none')
        .attr('stroke', '#999')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '2,3');
    }

    // SLA threshold ring (at 70% of radius)
    g.append('circle')
      .attr('r', radius * 0.7)
      .attr('fill', 'none')
      .attr('stroke', '#333')
      .attr('stroke-width', 1.5);

    // Draw segments and targets
    filteredData.forEach((groupData, groupIdx) => {
      const startAngle = groupIdx * anglePerGroup - Math.PI / 2;
      const endAngle = startAngle + anglePerGroup;
      const midAngle = (startAngle + endAngle) / 2;

      // Segment divider line
      const lineX = Math.cos(startAngle) * radius;
      const lineY = Math.sin(startAngle) * radius;
      g.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', lineX).attr('y2', lineY)
        .attr('stroke', '#ccc')
        .attr('stroke-width', 1);

      // Group label at the edge
      const labelR = radius + 20;
      const labelX = Math.cos(midAngle) * labelR;
      const labelY = Math.sin(midAngle) * labelR;
      const labelAngle = (midAngle * 180) / Math.PI;

      g.append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('transform', `rotate(${labelAngle > 90 || labelAngle < -90 ? labelAngle + 180 : labelAngle}, ${labelX}, ${labelY})`)
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .attr('fill', '#333')
        .text(groupData.group.name);

      // Targets within this segment
      const targets = groupData.targets;
      const targetAngleStep = anglePerGroup / (targets.length + 1);

      targets.forEach((target, tIdx) => {
        const angle = startAngle + targetAngleStep * (tIdx + 1);

        // Score determines radius position: 100 = center, 0 = edge
        const score = target.sla_score ?? 50;
        const targetR = radius * (1 - score / 100 * 0.9); // 100 → near center, 0 → edge

        // Min/max as line endpoints
        const minScore = target.latency_min != null && target.latency_max != null && target.latency_avg != null
          ? Math.max(0, score - (target.latency_avg - target.latency_min) / (groupData.group.sla_latency_ms * 3) * 100 * 0.3)
          : score;
        const maxScore = target.latency_min != null && target.latency_max != null && target.latency_avg != null
          ? Math.min(100, score + (target.latency_max - target.latency_avg) / (groupData.group.sla_latency_ms * 3) * 100 * 0.3)
          : score;

        const minR = radius * (1 - maxScore / 100 * 0.9);
        const maxR = radius * (1 - minScore / 100 * 0.9);

        const dotX = Math.cos(angle) * targetR;
        const dotY = Math.sin(angle) * targetR;
        const minX = Math.cos(angle) * minR;
        const minY = Math.sin(angle) * minR;
        const maxX = Math.cos(angle) * maxR;
        const maxY = Math.sin(angle) * maxR;

        // Radial guideline (faint)
        g.append('line')
          .attr('x1', 0).attr('y1', 0)
          .attr('x2', Math.cos(angle) * radius)
          .attr('y2', Math.sin(angle) * radius)
          .attr('stroke', '#eee')
          .attr('stroke-width', 0.5);

        // Min-max range line
        if (target.sla_score != null) {
          g.append('line')
            .attr('x1', minX).attr('y1', minY)
            .attr('x2', maxX).attr('y2', maxY)
            .attr('stroke', score >= 70 ? '#28a745' : '#dc3545')
            .attr('stroke-width', 2)
            .attr('opacity', 0.6);
        }

        // Target dot
        const dot = g.append('circle')
          .attr('cx', dotX)
          .attr('cy', dotY)
          .attr('r', 5)
          .attr('fill', target.sla_score == null ? '#999' : score >= 70 ? '#1a7431' : '#a71d2a')
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
          .attr('cursor', 'pointer');

        // Hover
        dot.on('mouseover', (event: MouseEvent) => {
          d3.select(event.currentTarget as Element).attr('r', 7);
          const rect = svgRef.current!.getBoundingClientRect();
          setTooltip({
            target,
            groupName: groupData.group.name,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        });

        dot.on('mouseout', (event: MouseEvent) => {
          d3.select(event.currentTarget as Element).attr('r', 5);
          setTooltip(null);
        });

        // Click
        dot.on('click', () => onTargetClick(target.id));
      });
    });

    // Center label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 10)
      .attr('fill', '#666')
      .text('SLA 100%');

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${size - 160}, ${size - 50})`);
    legend.append('rect').attr('width', 12).attr('height', 12).attr('fill', '#28a745').attr('opacity', 0.5);
    legend.append('text').attr('x', 16).attr('y', 10).attr('font-size', 11).text('SLA Compliant');
    legend.append('rect').attr('y', 18).attr('width', 12).attr('height', 12).attr('fill', '#dc3545').attr('opacity', 0.5);
    legend.append('text').attr('x', 16).attr('y', 28).attr('font-size', 11).text('SLA Breached');

  }, [data, size, selectedGroup, onTargetClick]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: 700, margin: '0 auto' }}>
      <svg ref={svgRef} width={size} height={size} />
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
