import { NotificationGateway } from '../../../src/notification/notification.gateway';

describe('NotificationGateway execution publications', () => {
  const message = {
    outboxId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
    socketEvent: 'askResponse',
    payload: { response: 'done' },
  };

  function gatewayWithRoom(roomSize: number, response: unknown) {
    const timeout = { emitWithAck: jest.fn().mockResolvedValue(response) };
    const to = { timeout: jest.fn().mockReturnValue(timeout) };
    const serverTo = jest.fn().mockReturnValue(to);
    const gateway = new NotificationGateway({} as any, {} as any);
    gateway.server = {
      sockets: {
        adapter: {
          rooms: new Map([['execution-owner:user-1', { size: roomSize }]]),
        },
      },
      to: serverTo,
    } as any;
    return { gateway, serverTo, to, timeout };
  }

  it('confirms publication only after the owner client accepts the outbox identity', async () => {
    const { gateway, serverTo, to, timeout } = gatewayWithRoom(1, [
      { accepted: true },
    ]);

    await expect(gateway.publishExecution('user-1', message)).resolves.toBe(
      true,
    );
    expect(serverTo).toHaveBeenCalledWith('execution-owner:user-1');
    expect(to.timeout).toHaveBeenCalledWith(5_000);
    expect(timeout.emitWithAck).toHaveBeenCalledWith(
      'execution:publication',
      message,
    );
  });

  it('keeps the publication pending when the owner rejects it', async () => {
    const { gateway } = gatewayWithRoom(1, [{ accepted: false }]);

    await expect(gateway.publishExecution('user-1', message)).resolves.toBe(
      false,
    );
  });

  it('does not publish when the owner has no connected clients', async () => {
    const { gateway, serverTo } = gatewayWithRoom(0, []);

    await expect(gateway.publishExecution('user-1', message)).resolves.toBe(
      false,
    );
    expect(serverTo).not.toHaveBeenCalled();
  });

  it('keeps the publication pending when the acknowledgement times out', async () => {
    const { gateway, timeout } = gatewayWithRoom(1, []);
    timeout.emitWithAck.mockRejectedValue(new Error('timeout'));

    await expect(gateway.publishExecution('user-1', message)).resolves.toBe(
      false,
    );
  });
});
