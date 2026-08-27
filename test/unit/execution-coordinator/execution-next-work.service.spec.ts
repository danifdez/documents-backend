import { ExecutionNextWorkService } from '../../../src/execution-coordinator/execution-next-work.service';

describe('ExecutionNextWorkService', () => {
  it('runs registered selectors in order before terminal promotion', async () => {
    const calls: string[] = [];
    const first = {
      selectorId: 'first',
      selectNextWork: jest.fn(async () => {
        calls.push('first');
        return 2;
      }),
    };
    const second = {
      selectorId: 'second',
      selectNextWork: jest.fn(async () => {
        calls.push('second');
        return 1;
      }),
    };
    const terminals = {
      promoteReady: jest.fn(async () => {
        calls.push('terminal');
        return 1;
      }),
    };
    const service = new ExecutionNextWorkService(
      [first, second],
      terminals as any,
    );

    await expect(service.select(4)).resolves.toEqual({
      selectedWorkItems: 3,
      terminalCandidates: 1,
    });
    expect(calls).toEqual(['first', 'second', 'terminal']);
    expect(second.selectNextWork).toHaveBeenCalledWith(2);
  });
});
