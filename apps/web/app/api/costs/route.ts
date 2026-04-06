/**
 * Cost data API route.
 * GET /api/costs?range=7d|30d|90d
 *
 * Returns mock cost analytics matching the dashboard structure.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get('range') ?? '30d';
    if (!['7d', '30d', '90d'].includes(range)) {
      return NextResponse.json({ error: 'Invalid range. Use 7d, 30d, or 90d.' }, { status: 400 });
    }

    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    const now = new Date();
    const monthlyBudgetCents = 3000; // $30.00

    // Generate daily spend data
    const spendByDay: { date: string; cents: number }[] = [];
    let totalSpendCents = 0;

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const baseCents = Math.floor(Math.random() * 150) + 20; // $0.20 - $1.70
      const weekendBoost = [0, 6].includes(date.getDay()) ? Math.floor(Math.random() * 200) + 50 : 0;
      const spend = baseCents + weekendBoost;
      totalSpendCents += spend;
      spendByDay.push({ date: date.toISOString(), cents: spend });
    }

    // Provider breakdown
    const providers = ['openai', 'stability', 'replicate'];
    const spendByProvider = providers.map((name, idx) => {
      const base = totalSpendCents * (0.6 - idx * 0.15) + Math.random() * 100;
      return {
        name,
        cents: Math.round(base),
        pct: 0, // calculated after
      };
    });
    const totalProviderCents = spendByProvider.reduce((s, p) => s + p.cents, 0);
    spendByProvider.forEach((p) => {
      p.pct = Math.round((p.cents / Math.max(totalProviderCents, 1)) * 100);
    });

    // Top projects
    const topProjects = [
      { projectId: 'p1', name: 'Fashion Collection', spendCents: Math.round(totalSpendCents * 0.35), jobsCount: 24 },
      { projectId: 'p2', name: 'Sneakers Catalog', spendCents: Math.round(totalSpendCents * 0.25), jobsCount: 18 },
      { projectId: 'p3', name: 'Electronics Store', spendCents: Math.round(totalSpendCents * 0.2), jobsCount: 12 },
      { projectId: 'p4', name: 'Cosmetics', spendCents: Math.round(totalSpendCents * 0.12), jobsCount: 8 },
    ].sort((a, b) => b.spendCents - a.spendCents);

    // Budget calculations
    const budgetUsedPct = Math.min(100, Math.round((totalSpendCents / Math.max(monthlyBudgetCents, 1)) * 100));
    const avgDailySpend = days > 0 ? Math.round(totalSpendCents / days * 100) / 100 : 0;
    const forecastMonthEnd = Math.round(totalSpendCents * (30 / Math.max(days, 1)));

    // Budget alerts
    const alerts: Array<{ type: 'warning' | 'critical'; message: string }> = [];
    if (budgetUsedPct > 80) {
      alerts.push({ type: 'critical', message: `Budget critical — ${budgetUsedPct}% of monthly budget consumed. Forecast: $${(forecastMonthEnd / 100).toFixed(2)}.` });
    } else if (budgetUsedPct > 60) {
      alerts.push({ type: 'warning', message: `Budget at ${budgetUsedPct%} — monitor usage to avoid overage.` });
    }
    if (forecastMonthEnd > monthlyBudgetCents) {
      alerts.push({ type: 'warning', message: `Forecast exceeds budget by $${((forecastMonthEnd - monthlyBudgetCents) / 100).toFixed(2)} — consider limiting generation.` });
    }

    return NextResponse.json({
      totalSpendCents,
      totalSpendFormatted: `$${(totalSpendCents / 100).toFixed(2)}`,
      avgDailySpend,
      monthlyBudgetCents,
      budgetUsedPct,
      forecastMonthEnd,
      spendByProvider,
      spendByDay,
      topProjects,
      alerts,
    });
  } catch (error) {
    console.error('Cost API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
