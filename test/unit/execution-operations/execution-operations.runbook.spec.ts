import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('execution harness operations runbook', () => {
  const runbook = readFileSync(
    resolve(process.cwd(), 'docs/execution-harness-operations.md'),
    'utf8',
  );

  it.each([
    'GET /execution-operations',
    '/execution-operations/reconcile',
    '/workers/$WORKER_ID/credential',
    '/workers/$WORKER_ID/credential-events',
    'EXECUTION_SLO_READY_MS',
    'EXECUTION_SLO_RESULT_COORDINATION_MS',
    'EXECUTION_SLO_PUBLICATION_MS',
    'POST /api/evidence/:bundleId/withdraw',
    'npm run harness:hardening:audit',
  ])('keeps the tested operational contract for %s', (contract) => {
    expect(runbook).toContain(contract);
  });

  it('keeps evaluation ownership in ai-train', () => {
    expect(runbook).toContain(
      'ai-train is the only component that\nevaluates captured evidence',
    );
  });
});
