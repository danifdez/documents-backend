import { ExecutionPublicationStore } from '../../../src/execution-outbox/execution-publication.store';
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
    service = new ExecutionOutboxService(
      new ExecutionPublicationStore(dataSource as any),
      gateway as any,
    );
  });

  it('claims and marks a publication as published after socket delivery', async () => {
    manager.query
      .mockResolvedValueOnce([
        [
          {
            outbox_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
            socket_event: 'askResponse',
            payload: { response: 'done' },
            attempts: 1,
            owner_principal: 'user-7',
          },
        ],
        1,
      ])
      .mockResolvedValueOnce([[], 0]);
    gateway.publishExecution.mockResolvedValue(true);

    await expect(service.publishPending()).resolves.toBe(1);
    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(manager.query.mock.calls[0][0]).toContain(`"status" = 'publishing'`);
    expect(manager.query.mock.calls[0][0]).toContain('owner_principal');
    expect(gateway.publishExecution).toHaveBeenCalledWith('user-7', {
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
      [
        {
          outbox_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
          socket_event: 'notification',
          payload: { type: 'summarize' },
          attempts: 2,
          owner_principal: 'user-7',
        },
      ],
      1,
    ]);
    manager.query.mockResolvedValueOnce([[], 0]);
    gateway.publishExecution.mockResolvedValue(false);

    await expect(service.publishPending()).resolves.toBe(0);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining(`SET "status" = 'pending'`),
      ['018f1d8a-54d7-7d63-a1ee-5e9a6adca701', 2, 2, 'no_connected_clients'],
    );
  });

  it('continues with other owners after deferring an undelivered publication', async () => {
    const first = {
      outbox_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      socket_event: 'notification',
      payload: {},
      attempts: 1,
      owner_principal: 'user-7',
    };
    const second = {
      ...first,
      outbox_id: '018f1d8a-54d7-7d63-a1ee-5e9a6adca702',
      owner_principal: 'user-8',
    };
    manager.query
      .mockResolvedValueOnce([[first], 1])
      .mockResolvedValueOnce([[second], 1]);
    gateway.publishExecution
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(service.publishPending(2)).resolves.toBe(1);
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`SET "status" = 'pending'`),
      [first.outbox_id, 1, 1, 'no_connected_clients'],
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`SET "status" = 'published'`),
      [second.outbox_id, 1],
    );
  });

  it('stops when the current TypeORM update result has no claimed rows', async () => {
    manager.query.mockResolvedValueOnce([[], 0]);

    await expect(service.publishPending()).resolves.toBe(0);
    expect(gateway.publishExecution).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
