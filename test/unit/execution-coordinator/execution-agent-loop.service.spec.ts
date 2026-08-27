import { ExecutionAgentLoopService } from '../../../src/execution-coordinator/execution-agent-loop.service';

const OPERATION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

describe('ExecutionAgentLoopService', () => {
  it('releases a failed child join and prepares its parent operation', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([[{ operation_id: OPERATION_ID }], 1])
      .mockResolvedValueOnce([]);
    const service = new ExecutionAgentLoopService(
      {
        transaction: jest.fn(async (callback) => callback({ query })),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.releaseTerminalDelegations(4)).resolves.toBe(1);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        "child.\"status\" IN ('completed', 'failed', 'cancelled')",
      ),
      [4],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"status" = \'prepared\''),
      [[OPERATION_ID]],
    );
  });

  it('does not update operations when no terminal child join is waiting', async () => {
    const query = jest.fn().mockResolvedValue([[], 0]);
    const service = new ExecutionAgentLoopService(
      {
        transaction: jest.fn(async (callback) => callback({ query })),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.releaseTerminalDelegations()).resolves.toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
