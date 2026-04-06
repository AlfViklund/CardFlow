/**
 * User-facing usage dashboard page (task 467298fa).
 *
 * Displays:
 * - Current credit balance + low-balance warning
 * - Consumption timeline (daily bar chart via inline SVG)
 * - Breakdown by project (table with card count, stage, credits used)
 * - Date-range filter (7d / 30d / 90d)
 */
'use client';

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UsageData {
  balance: number;
  creditsPerPeriod: number;
  periodStart: string;
  periodEnd: string;
  plan: string;
  consumptionByDay: { date: string; credits: number }[];
  projects: {
    projectId: string;
    projectName: string;
    cardsGenerated: number;
    creditsUsed: number;
    lastStage: string;
  }[];
  totalConsumed: number;
  avgDaily: number;
  lowBalanceThreshold: number;
}

type DateRange = '7d' | '30d' | '90d';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentUsed(credits: number, total: number): number {
  return total > 0 ? Math.round((1 - credits / total) * 100) : 0;
}

function balanceClass(
  balance: number,
  threshold: number,
): string {
  if (balance <= 0) return 'text-red-400';
  if (balance <= threshold) return 'text-yellow-400';
  return 'text-green-400';
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function parseUsageDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Mini bar chart component (inline SVG, no deps)
// ---------------------------------------------------------------------------

function BarChart({
  data,
  width = 700,
  height = 160,
}: {
  data: { date: string; credits: number }[];
  width?: number;
  height?: number;
}) {
  const maxCredits = Math.max(...data.map((d) => d.credits), 1);
  const barWidth = Math.max(4, (width - 60) / data.length - 2);
  const chartHeight = height - 40;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxHeight: height }}>
      <g transform="translate(50, 5)">
        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
          const y = chartHeight - frac * chartHeight;
          return (
            <g key={i}>
              <line x1="0" y1={y} x2="100%" y2={y} stroke="#2a3456" strokeWidth="0.5" />
              <text x="-6" y={y + 4} textAnchor="end" fontSize="9" fill="#9fb0dc">
                {Math.round(maxCredits * frac)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, idx) => {
          const barH = (d.credits / maxCredits) * chartHeight;
          const x = idx * (barWidth + 2);
          return (
            <g key={idx}>
              <rect
                x={x}
                y={chartHeight - barH}
                width={barWidth}
                height={barH}
                rx="2"
                fill={d.credits > 0 ? '#7cc4ff' : '#2a3456'}
                opacity={d.credits > 0 ? 0.85 : 0.5}
              />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 14}
                textAnchor="middle"
                fontSize="7"
                fill="#9fb0dc"
              >
                {d.date.slice(0, 5)}
              </text>
            </g>
          );
        })}
        {/* Baseline */}
        <line x1="0" y1={chartHeight} x2="100%" y2={chartHeight} stroke="#3a4d70" strokeWidth="1" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Usage Dashboard
// ---------------------------------------------------------------------------

export default function UsagePage() {
  const [range, setRange] = useState<DateRange>('30d');
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch usage data from the API route
  const fetchUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/usage?range=${range}`);
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsage();
  }, [range]);

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 w-48 bg-panel-2 rounded mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-panel rounded-lg p-5 h-28" />
            ))}
          </div>
          <div className="bg-panel rounded-lg p-5 h-56" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-5 text-red-300">
          <h2 className="text-lg font-semibold mb-2">Failed to load usage data</h2>
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchUsage}
            className="mt-3 px-4 py-2 bg-red-800 hover:bg-red-700 rounded text-sm text-red-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const pct = percentUsed(data.balance, data.creditsPerPeriod);
  const isLow = data.balance <= data.lowBalanceThreshold;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Usage Dashboard</h1>
          <p className="text-sm text-muted mt-1">
            Period: {formatDate(data.periodStart)} — {formatDate(data.periodEnd)} ({data.plan} plan)
          </p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-panel-2 text-muted hover:bg-panel border border-transparent'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Balance */}
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Remaining Credits</p>
          <p className={`text-3xl font-bold ${balanceClass(data.balance, data.lowBalanceThreshold)}`}>
            {data.balance}
          </p>
          <div className="mt-3">
            <div className="h-1.5 bg-panel-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isLow ? 'bg-yellow-500' : pct > 80 ? 'bg-red-500' : 'bg-accent'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted mt-1.5">{pct}% used of {data.creditsPerPeriod}</p>
          </div>
          {isLow && (
            <p className="mt-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded px-2 py-1">
              ⚠️ Low balance warning — credits running low
            </p>
          )}
        </div>

        {/* Total consumed */}
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Total Consumed</p>
          <p className="text-3xl font-bold text-text">{data.totalConsumed}</p>
          <p className="text-xs text-muted mt-3">
            Avg. {data.avgDaily} credits/day
          </p>
        </div>

        {/* Projects using credits */}
        <div className="bg-panel rounded-lg p-5 border border-border">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Active Projects</p>
          <p className="text-3xl font-bold text-text">{data.projects.length}</p>
          <div className="mt-3 space-y-1.5">
            {data.projects.slice(0, 3).map((p) => (
              <div className="flex justify-between text-xs" key={p.projectId}>
                <span className="text-muted truncate max-w-[80%]">{p.projectName}</span>
                <span className="text-text font-mono">{p.creditsUsed}c</span>
              </div>
            ))}
            {data.projects.length > 3 && (
              <p className="text-xs text-muted">+{data.projects.length - 3} more</p>
            )}
          </div>
        </div>
      </div>

      {/* Consumption Chart */}
      <div className="bg-panel rounded-lg p-5 border border-border">
        <h2 className="text-sm font-semibold text-text mb-4">Daily Consumption</h2>
        <BarChart data={data.consumptionByDay} />
      </div>

      {/* Projects Table */}
      <div className="bg-panel rounded-lg border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Breakdown by Project</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">
                  Project
                </th>
                <th className="text-right px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">
                  Cards
                </th>
                <th className="text-right px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">
                  Credits Used
                </th>
                <th className="text-left px-5 py-3 text-xs uppercase tracking-wider text-muted font-medium">
                  Last Stage
                </th>
              </tr>
            </thead>
            <tbody>
              {data.projects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted">
                    No project data yet. Generate some cards to see usage.
                  </td>
                </tr>
              ) : (
                data.projects.map((p) => (
                  <tr
                    key={p.projectId}
                    className="border-b border-border hover:bg-panel-2 transition-colors"
                  >
                    <td className="px-5 py-3 text-text font-medium">{p.projectName}</td>
                    <td className="px-5 py-3 text-right text-muted font-mono">{p.cardsGenerated}</td>
                    <td className="px-5 py-3 text-right text-text font-mono">{p.creditsUsed}</td>
                    <td className="px-5 py-3">
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent">
                        {p.lastStage || '—'}
                      </span>
                    </td>
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
