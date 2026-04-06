/**
 * Usage data API route.
 * GET /api/usage?range=7d|30d|90d
 *
 * Returns mock data structure matching what the dashboard expects.
 * In production, this would query the credits_ledger and projects tables.
 */
import { NextRequest, NextResponse } from 'next/server';

interface DayData {
  date: string;
  credits: number;
}

interface ProjectUsage {
  projectId: string;
  projectName: string;
  cardsGenerated: number;
  creditsUsed: number;
  lastStage: string;
}

interface UsageResponse {
  balance: number;
  creditsPerPeriod: number;
  periodStart: string;
  periodEnd: string;
  plan: string;
  consumptionByDay: DayData[];
  projects: ProjectUsage[];
  totalConsumed: number;
  avgDaily: number;
  lowBalanceThreshold: number;
}

// Generate realistic mock data for the dashboard demo
function generateMockData(range: string): UsageResponse {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const now = new Date();

  const consumptionByDay: DayData[] = [];
  const sampleProjects: ProjectUsage[] = [
    { projectId: 'p1', projectName: 'Men\'s Fashion Collection', cardsGenerated: 24, creditsUsed: 72, lastStage: 'final' },
    { projectId: 'p2', projectName: 'Women\'s Sneakers', cardsGenerated: 18, creditsUsed: 54, lastStage: 'design-concept' },
    { projectId: 'p3', projectName: 'Electronics Store', cardsGenerated: 32, creditsUsed: 96, lastStage: 'scenes' },
    { projectId: 'p4', projectName: 'Cosmetics Catalog', cardsGenerated: 12, creditsUsed: 36, lastStage: 'final' },
    { projectId: 'p5', projectName: 'Home & Kitchen', cardsGenerated: 8, creditsUsed: 24, lastStage: 'brief' },
  ];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const baseCredits = Math.floor(Math.random() * 5) + 1;
    const spike = Math.random() > 0.8 ? Math.floor(Math.random() * 8) + 3 : 0;
    consumptionByDay.push({
      date: date.toISOString(),
      credits: baseCredits + spike,
    });
  }

  const totalConsumed = consumptionByDay.reduce((sum, d) => sum + d.credits, 0);
  const avgDaily = Math.round(totalConsumed / days * 10) / 10;

  return {
    balance: 145,
    creditsPerPeriod: 500,
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    plan: 'pro',
    consumptionByDay,
    projects: sampleProjects,
    totalConsumed,
    avgDaily,
    lowBalanceThreshold: 50,
  };
}

export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get('range') ?? '30d';

    if (!['7d', '30d', '90d'].includes(range)) {
      return NextResponse.json(
        { error: 'Invalid range. Use 7d, 30d, or 90d.' },
        { status: 400 },
      );
    }

    const data = generateMockData(range);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Usage API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
