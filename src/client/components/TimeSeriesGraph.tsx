import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import type { Measurement } from '../api/client';

Chart.register(...registerables);

interface Props {
  measurements: Measurement[];
  title?: string;
  // Optional explicit X-axis range (unix seconds). When set, the time axis
  // spans [from, to] even if measurements only cover part of it — so picking
  // 30d shows a real 30-day window instead of zooming into recent data.
  from?: number;
  to?: number;
}

export default function TimeSeriesGraph({ measurements, title, from, to }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Sort by timestamp ascending
    const sorted = [...measurements].sort((a, b) => a.timestamp - b.timestamp);

    const points = sorted.map(m => ({ x: m.timestamp * 1000, y: m.latency_avg }));
    const minPoints = sorted.map(m => ({ x: m.timestamp * 1000, y: m.latency_min }));
    const maxPoints = sorted.map(m => ({ x: m.timestamp * 1000, y: m.latency_max }));
    const lossData = sorted.map(m => m.loss_pct);

    // Color points by loss percentage
    const pointColors = lossData.map(loss => {
      if (loss === 0) return '#16a34a';
      if (loss < 10) return '#eab308';
      if (loss < 50) return '#f97316';
      return '#dc2626';
    });

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const xMin = from != null ? from * 1000 : undefined;
    const xMax = to != null ? to * 1000 : undefined;
    const rangeSec = from != null && to != null ? to - from : null;

    // Pick a sensible time unit so axis ticks don't crowd
    let timeUnit: 'minute' | 'hour' | 'day' | undefined;
    if (rangeSec != null) {
      if (rangeSec <= 3 * 3600) timeUnit = 'minute';
      else if (rangeSec <= 3 * 86400) timeUnit = 'hour';
      else timeUnit = 'day';
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Max Latency',
            data: maxPoints,
            borderColor: 'rgba(220, 38, 38, 0.35)',
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            fill: '+1',
            pointRadius: 0,
            borderWidth: 1,
            tension: 0.25,
          },
          {
            label: 'Avg Latency',
            data: points,
            borderColor: '#2563eb',
            backgroundColor: 'transparent',
            pointBackgroundColor: pointColors,
            pointRadius: 2.5,
            pointHoverRadius: 6,
            borderWidth: 2,
            tension: 0.25,
          },
          {
            label: 'Min Latency',
            data: minPoints,
            borderColor: 'rgba(22, 163, 74, 0.35)',
            backgroundColor: 'rgba(22, 163, 74, 0.08)',
            fill: '-1',
            pointRadius: 0,
            borderWidth: 1,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: !!title,
            text: title || '',
            font: { size: 14 },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              afterBody(items) {
                const idx = items[0]?.dataIndex;
                if (idx != null) {
                  const jitter = sorted[idx]?.jitter;
                  const loss = sorted[idx]?.loss_pct;
                  const score = sorted[idx]?.sla_score;
                  return [
                    `Jitter: ${jitter?.toFixed(2)} ms`,
                    `Loss: ${loss?.toFixed(1)}%`,
                    `SLA Score: ${score?.toFixed(1)}`,
                  ];
                }
                return [];
              },
            },
          },
          legend: {
            position: 'bottom',
          },
        },
        scales: {
          x: {
            type: 'time',
            min: xMin,
            max: xMax,
            time: {
              unit: timeUnit,
              tooltipFormat: 'PPpp',
            },
            title: { display: true, text: 'Time' },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
          },
          y: {
            title: { display: true, text: 'Latency (ms)' },
            beginAtZero: true,
          },
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false,
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [measurements, title, from, to]);

  return (
    <div style={{ height: 400, position: 'relative' }}>
      <canvas ref={canvasRef} />
      {measurements.length === 0 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: 13,
          pointerEvents: 'none',
        }}>
          No measurement data in this time range yet.
        </div>
      )}
    </div>
  );
}
