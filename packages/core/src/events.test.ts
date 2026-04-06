import assert from 'node:assert';
import {
  createProjectEvent,
  createGenerationEvent,
  createExportEvent,
  categorizeEventType,
  type EventType,
} from './events';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err}`);
    failed++;
  }
}

async function main() {
  console.log('Event Tracking Tests (a054cea4)\n');
  console.log('='.repeat(50));

  await test('createProjectEvent has required fields', () => {
    const event = createProjectEvent('project_created', 'proj-1', 'user-1', { plan: 'free' });
    assert(event.id);
    assert(event.timestamp);
    assert.strictEqual(event.category, 'project');
    assert.strictEqual(event.type, 'project_created');
    assert.strictEqual(event.projectId, 'proj-1');
    assert.strictEqual(event.userId, 'user-1');
  });

  await test('createGenerationEvent includes job/tracing fields', () => {
    const event = createGenerationEvent('job_completed', 'proj-1', 'job-1', {
      userId: 'user-1',
      cardId: 'card-1',
      modelId: 'dall-e-3',
      resolution: '2000x2000',
      costEstimateCents: 300,
    });
    assert.strictEqual(event.category, 'generation');
    assert.strictEqual(event.jobId, 'job-1');
    assert.strictEqual(event.modelId, 'dall-e-3');
    assert.strictEqual(event.resolution, '2000x2000');
    assert.strictEqual(event.costEstimateCents, 300);
  });

  await test('createExportEvent for export_blocked_compliance', () => {
    const event = createExportEvent('export_blocked_compliance', 'proj-1', {
      userId: 'user-1',
      costEstimateCents: 0,
      data: { criticalFailures: 2 },
    });
    assert.strictEqual(event.type, 'export_blocked_compliance');
    assert.strictEqual(event.category, 'export');
  });

  await test('categorizeEventType: project events', () => {
    assert.strictEqual(categorizeEventType('project_created' as EventType), 'project');
    assert.strictEqual(categorizeEventType('step_approved' as EventType), 'project');
    assert.strictEqual(categorizeEventType('step_rejected' as EventType), 'project');
  });

  await test('categorizeEventType: generation events', () => {
    assert.strictEqual(categorizeEventType('job_queued' as EventType), 'generation');
    assert.strictEqual(categorizeEventType('job_failed' as EventType), 'generation');
    assert.strictEqual(categorizeEventType('credit_consumed' as EventType), 'generation');
  });

  await test('categorizeEventType: export events', () => {
    assert.strictEqual(categorizeEventType('export_completed' as EventType), 'export');
    assert.strictEqual(categorizeEventType('export_failed' as EventType), 'export');
    assert.strictEqual(categorizeEventType('export_blocked_compliance' as EventType), 'export');
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => { console.error(err); process.exit(1); });
