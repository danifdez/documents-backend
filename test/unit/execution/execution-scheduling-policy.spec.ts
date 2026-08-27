import {
  executionSchedulingScore,
  ExecutionSchedulingCandidate,
} from '../../../src/execution/execution-scheduling-policy';

const NOW = new Date('2026-08-27T10:00:00.000Z');

function candidate(
  overrides: Partial<ExecutionSchedulingCandidate> = {},
): ExecutionSchedulingCandidate {
  return {
    priority: 0,
    availableAt: NOW,
    deadline: null,
    ...overrides,
  };
}

describe('execution scheduling fairness properties', () => {
  it('is monotonic for priority, age and deadline urgency', () => {
    for (const priority of [-100, 0, 100]) {
      for (const ageMinutes of [0, 1, 30, 201]) {
        const base = candidate({
          priority,
          availableAt: new Date(NOW.getTime() - ageMinutes * 60_000),
        });
        expect(
          executionSchedulingScore({ ...base, priority: priority + 1 }, NOW),
        ).toBeGreaterThan(executionSchedulingScore(base, NOW));
        expect(
          executionSchedulingScore(
            {
              ...base,
              availableAt: new Date(base.availableAt.getTime() - 60_000),
            },
            NOW,
          ),
        ).toBeGreaterThan(executionSchedulingScore(base, NOW));

        for (const deadlineSeconds of [299, 120, 30]) {
          const farther = {
            ...base,
            deadline: new Date(NOW.getTime() + deadlineSeconds * 1_000),
          };
          const nearer = {
            ...farther,
            deadline: new Date(farther.deadline.getTime() - 1_000),
          };
          expect(executionSchedulingScore(nearer, NOW)).toBeGreaterThan(
            executionSchedulingScore(farther, NOW),
          );
        }
      }
    }
  });

  it('eventually promotes old background work over newly ready high work', () => {
    const oldBackground = candidate({
      priority: -100,
      availableAt: new Date(NOW.getTime() - 201 * 60_000),
    });
    const newHigh = candidate({ priority: 100 });

    expect(executionSchedulingScore(oldBackground, NOW)).toBeGreaterThan(
      executionSchedulingScore(newHigh, NOW),
    );
  });

  it('raises urgency only inside the five-minute deadline horizon', () => {
    expect(
      executionSchedulingScore(
        candidate({ deadline: new Date(NOW.getTime() + 301_000) }),
        NOW,
      ),
    ).toBe(0);
    expect(
      executionSchedulingScore(
        candidate({ deadline: new Date(NOW.getTime() + 60_000) }),
        NOW,
      ),
    ).toBe(240);
  });
});
