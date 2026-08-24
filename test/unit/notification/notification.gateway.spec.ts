import { NotificationGateway } from '../../../src/notification/notification.gateway';

describe('NotificationGateway execution publications', () => {
  const message = {
    outboxId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
    socketEvent: 'askResponse',
    payload: { response: 'done' },
  };

  function client(response: unknown) {
    const socket = {
      timeout: jest.fn(),
      emitWithAck: jest.fn().mockResolvedValue(response),
    };
    socket.timeout.mockReturnValue(socket);
    return socket;
  }

  it('confirms publication only after a client accepts the outbox identity', async () => {
    const gateway = new NotificationGateway({} as any, {} as any);
    const accepted = client({ accepted: true });
    gateway.server = {
      sockets: { sockets: new Map([['client-1', accepted]]) },
    } as any;

    await expect(gateway.publishExecution(message)).resolves.toBe(true);
    expect(accepted.timeout).toHaveBeenCalledWith(5_000);
    expect(accepted.emitWithAck).toHaveBeenCalledWith(
      'execution:publication',
      message,
    );
  });

  it('keeps the publication pending when every client rejects it', async () => {
    const gateway = new NotificationGateway({} as any, {} as any);
    const disconnected = client(null);
    disconnected.emitWithAck.mockRejectedValue(new Error('disconnected'));
    gateway.server = {
      sockets: {
        sockets: new Map([
          ['client-1', client({ accepted: false })],
          ['client-2', disconnected],
        ]),
      },
    } as any;

    await expect(gateway.publishExecution(message)).resolves.toBe(false);
  });
});
