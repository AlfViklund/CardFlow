/**
 * Cost dashboard with AI spend metrics (task 12470069).
 *
 * Displays:
 * - Total AI generation spend (credits/cents)
 * - Spend by provider (pie chart via inline SVG)
 * - Spend over time (area chart)
 * - Per-project cost breakdown
 * - Budget alerts and forecast
 */
'use client';

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostData {
  totalSpendCents: number;
  totalSpendFormatted: string;
  avgDailySpend: number;
  monthlyBudgetCents: number;
  budgetUsedPct: number;
  forecastMonthEnd: number;
  spendByProvider: { name: string; cents: number; pct: number }[];
  spendByDay: { date: string; cents: number }[];
  topProjects: { projectId: string; name: string; spendCents: number; jobsCount: number }[];
  alerts: { type: 'warning' | 'critical'; message: string }[];
}

type DateRange = '7d' | '30d' | '90d';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCents(cents: number): string {
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#a78bfa',
  stability: '#34d399',
  replicate: '#f59e0b',
  midjourney: '#f472b6',
  gemini: '#60a5fa',
  'nano-banana': '#fb923c',
  default: '#94a3b8',
};

// ---------------------------------------------------------------------------
// Area chart component (inline SVG)
// ---------------------------------------------------------------------------

function AreaChart({
  data,
  color = '#7cc4ff',
  width = 700,
  height = 160,
}: {
  data: { date: string; cents: number }[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const maxVal = Math.max(...data.map((d) => d.cents), 1);
  const padding = { left: 60, top: 10, bottom: 30, right: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  if (data.length === 0) return null;

  const points = data.map((d, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH - (d.cents / maxVal) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1]?.x ?? 0} ${padding.top + chartH} L${points[0]?.x ?? 0} ${padding.top + chartH} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxHeight: height }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <g>
        {/* Grid lines */}
        {[0, 0.5, 1].map((f, i) => {
          const y = padding.top + chartH * (1 - f);
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#2a3456" strokeWidth="0.5" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="9" fill="#9fb0dc">
                {formatCents(Math.round(maxVal * f))}
              </text>
            </g>
          );
        })}
        {/* Area */}
        <path d={areaPath} fill="url(#areaGrad)" />
        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" />
        {/* X-axis labels */}
        {data.filter((_, i) => i % Math.ceil(data.length / 10) === 0 || i === data.length - 1).map((d, idx) => {
          const i = data.indexOf(d);
          const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
          return (
            <text key={idx} x={x} y={height - 5} textAnchor="middle" fontSize="8" fill="#9fb0dc">
              {formatDateShort(d.date)}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Donut chart for provider breakdown
// ---------------------------------------------------------------------------

function DonutChart({
  data,
  size = 120,
}: {
  data: { name: string; cents: number; pct: number }[];
  size?: number;
}) {
  const radius = size / 2 - 10;
  const innerRadius = radius * 0.6;
  const cx = size / 2;
  const cy = size / 2;

  let cumAngle = -Math.PI / 2;

  const segments = data
    .filter((d) => d.cents > 0)
    .map((d) => {
      const angle = (d.pct / 100) * 2 * Math.PI;
      const startAngle = cumAngle;
      const endAngle = cumAngle + angle;
      cumAngle = endAngle;

      const x1 = cx + radius * Math.cos(startAngle);
      const y1 = cy + radius * Math.sin(startAngle);
      const x2 = cx + radius * Math.cos(endAngle);
      const y2 = cy + radius * Math.sin(endAngle);
      const ix1 = cx + innerRadius * Math.cos(startAngle);
      const iy1 = cy + innerRadius * Math.sin(startAngle);
      const ix2 = cx + innerRadius * Math.cos(endAngle);
      const iy2 = cy + innerRadius * Math.sin(endAngle);

      const largeArc = angle > Math.PI ? 1 : 0;

      const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;

      return { ...d, path };
    });

  return (
    <svg width={size} height={size}>
      {segments.map((seg, i) => (
        <path
          key={i}
          d={seg.path}
          fill={PROVIDER_COLORS[seg.name] ?? PROVIDER_COLORS.default}
          stroke="#1a2342"
          strokeWidth="1"
        />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="10" fill="#e9efff" fontWeight="bold">
        {data.length}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize="8" fill="#9fb0dc">
        providers
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CostDashboard
// ---------------------------------------------------------------------------

export default function CostDashboardPage() {
  const [range, setRange] = useState<DateRange>('30d');
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/costs?range=${range}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cost data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [range]);

  if (loading) return <div className="p-6 max-w-5xl mx-auto animate-pulse"><div className="h-8 w-48 bg-panel-2 rounded mb-6" /><div className="grid grid-cols-1 md:grid-cols-4 gap-4"><div className="bg-panel rounded-lg h-24" /><div className="bg-panel rounded-lg h-24" /><div className="bg-panel rounded-lg h-24" /><div className="bg-panel rounded-lg h-24" /></div></div>;
  if (error) return <div className="p-6 max-w-5xl mx-auto"><div className="bg-red-900/30 border border-red-800 rounded-lg p-5 text-red-300"><h2 className="text-lg font-semibold mb-2">Failed to load cost data</h2><p className="text-sm text-red-400">{error}</p><button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-800 hover:bg-red-700 rounded text-sm text-red-200">Retry</button></div></div>;
  if (!data) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Cost Dashboard</h1>
          <p className="text-sm text-muted mt-1">AI generation spend metrics</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${range === r ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-panel-2 text-muted hover:bg-panel border border-transparent'}`}>{r}</button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((a, i) => (
            <div key={i} className={`p-4 rounded-lg border ${a.type === 'critical' ? 'bg-red-900/20 border-red-800 text-red-300' : 'bg-yellow-900/20 border-yellow-800 text-yellow-300'}`}>
              <span className="mr-2">{a.type === 'critical' ? '🔴' : '🟡'}</span>
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Total Spend</p>
          <p className="text-3xl font-bold text-text">{formatCents(data.totalSpendCents)}</p>
        </div>
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Avg Daily</p>
          <p className="text-3xl font-bold text-text">{formatCents(data.avgDailySpend)}</p>
        </div>
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Budget Used</p>
          <p className="text-3xl font-bold text-text">{data.budgetUsedPct}%</p>
          <div className="h-1 bg-panel-2 rounded-full mt-2"><div className={`h-full rounded-full ${data.budgetUsedPct > 90 ? 'bg-red-500' : data.budgetUsedPct > 70 ? 'bg-yellow-500' : 'bg-accent'}`} style={{ width: `${data.budgetUsedPct}%` }} /></div>
        </div>
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Forecast (Month)</p>
          <p className="text-3xl font-bold text-text">{formatCents(data.forecastMonthEnd)}</p>
          <p className="text-xs text-muted mt-1">Budget: {formatCents(data.monthlyBudgetCents)}</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Spend over time */}
        <div className="md:col-span-2 bg-panel rounded-lg p-5 border border-border">
          <h2 className="text-sm font-semibold text-text mb-4">Spend Over Time</h2>
          <AreaChart data={data.spendByDay} color="#7cc4ff" />
        </div>
        {/* Provider breakdown */}
        <div className="bg-panel rounded-lg p-5 border border-border">
          <h2 className="text-sm font-semibold text-text mb-4">By Provider</h2>
          <div className="flex items-center gap-4 mb-4">
            <DonutChart data={data.spendByProvider} size={100} />
            <div className="space-y-1.5">
              {data.spendByProvider.filter((p) => p.cents > 0).map((p) => (
                <div key={p.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[p.name] ?? PROVIDER_COLORS.default }} />
                  <span className="text-muted capitalize">{p.name}</span>
                  <span className="text-text font-mono">{formatCents(p.cents)}</span>
                  <span className="text-muted">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-panel rounded-lg border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Top Projects by Cost</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">Project</th>
                <th className="text-right px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">Jobs</th>
                <th className="text-right px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">Total Cost</th>
                <th className="text-right px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">Cost/Job</th>
              </tr>
            </thead>
            <tbody>
              {data.topProjects.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">No cost data yet</td></tr>
              ) : (
                data.topProjects.map((p) => (
                  <tr key={p.projectId} className="border-b border-border hover:bg-panel-2 transition-colors">
                    <td className="px-5 py-3 text-text font-medium">{p.name}</td>
                    <td className="px-5 py-3 text-right text-muted font-mono">{p.jobsCount}</td>
                    <td className="px-5 py-3 text-right text-text font-mono font-semibold">{formatCents(p.spendCents)}</td>
                    <td className="px-5 py-3 text-right text-muted font-mono">{formatCents(Math.round(p.spendCents / Math.max(p.jobsCount, 1)))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
