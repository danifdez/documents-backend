import { ExecutionOutboxService } from '../../../src/execution-outbox/execution-outbox.service';

describe('ExecutionOutboxService', () => {
  let manager: { query: jest.Mock };
  let dataSource: { transaction: jest.Mock; query: jest.Mock };
  let gateway: { publishExecution: jest.Mock };
  let service: ExecutionOutboxService;

  beforeEach(() => {
    manager = { query: jest.fn() };
    dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      query: jest.fn(async () => []),
    };
    gateway = { publishExecution: jest.fn() };
    service = new ExecutionOutboxService(dataSource as any, gateway as any);
  });

  it('claims and marks a publication as published after socket delivery', async () => {
    manager.query
      .mockResolvedValueOnce([
        {
          outbox_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
          socket_event: 'askResponse',
          payload: { response: 'done' },
          attempts: 1,
        },
      ])
      .mockResolvedValueOnce([]);
    gateway.publishExecution.mockResolvedValue(true);

    await expect(service.publishPending()).resolves.toBe(1);
    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(manager.query.mock.calls[0][0]).toContain(`"status" = 'publishing'`);
    expect(gateway.publishExecution).toHaveBeenCalledWith({
      outboxId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      socketEvent: 'askResponse',
      payload: { response: 'done' },
    });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining(`SET "status" = 'published'`),
      ['018f1d8a-54d7-7d63-a1ee-5e9a6adca701', 1],
    );
  });

  it('returns the publication to pending when no client is connected', async () => {
    manager.query.mockResolvedValueOnce([
      {
        outbox_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
        socket_event: 'notification',
        payload: { type: 'summarize' },
        attempts: 2,
      },
    ]);
    gateway.publishExecution.mockResolvedValue(false);

    await expect(service.publishPending()).resolves.toBe(0);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining(`SET "status" = 'pending'`),
      ['018f1d8a-54d7-7d63-a1ee-5e9a6adca701', 2, 2, 'no_connected_clients'],
    );
  });
});
