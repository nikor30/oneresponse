import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import type { Measurement } from '../api/client';

Chart.register(...registerables);

interface Props {
  measurements: Measurement[];
  title?: string;
}

export default function TimeSeriesGraph({ measurements, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || measurements.length === 0) return;

    // Sort by timestamp ascending
    const sorted = [...measurements].sort((a, b) => a.timestamp - b.timestamp);

    const labels = sorted.map(m => new Date(m.timestamp * 1000));
    const avgData = sorted.map(m => m.latency_avg);
    const minData = sorted.map(m => m.latency_min);
    const maxData = sorted.map(m => m.latency_max);
    const lossData = sorted.map(m => m.loss_pct);

    // Color points by loss percentage
    const pointColors = lossData.map(loss => {
      if (loss === 0) return '#28a745';
      if (loss < 10) return '#ffc107';
      if (loss < 50) return '#fd7e14';
      return '#dc3545';
    });

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Max Latency',
            data: maxData,
            borderColor: 'rgba(220, 53, 69, 0.3)',
            backgroundColor: 'rgba(220, 53, 69, 0.05)',
            fill: '+1',
            pointRadius: 0,
            borderWidth: 1,
            tension: 0.3,
          },
          {
            label: 'Avg Latency',
            data: avgData,
            borderColor: '#0d6efd',
            backgroundColor: 'transparent',
            pointBackgroundColor: pointColors,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2,
            tension: 0.3,
          },
          {
            label: 'Min Latency',
            data: minData,
            borderColor: 'rgba(40, 167, 69, 0.3)',
            backgroundColor: 'rgba(40, 167, 69, 0.05)',
            fill: '-1',
            pointRadius: 0,
            borderWidth: 1,
            tension: 0.3,
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
            time: {
              tooltipFormat: 'PPpp',
            },
            title: { display: true, text: 'Time' },
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
  }, [measurements, title]);

  if (measurements.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>No measurement data available yet.</div>;
  }

  return (
    <div style={{ height: 400, position: 'relative' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
