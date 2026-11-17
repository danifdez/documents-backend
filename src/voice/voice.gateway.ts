import { EXECUTION_UUID_PATTERN } from '../execution/execution.constants';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { AuthService } from '../auth/auth.service';
import { Permission } from '../auth/permission.enum';
import { Server, Socket } from 'socket.io';
import { VoiceService } from './voice.service';

interface VoiceConnection {
  principal: string;
  expiresAt?: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  pending: Promise<void>;
  queued: number;
}

/**
 * Socket.IO gateway for live dictation.
 *
 * Lives in a dedicated namespace (`/voice`) so it does not share the
 * connection/auth pipeline of `NotificationGateway` and clients can connect
 * lazily only when the user starts dictating.
 *
 * Event names are fixed here and reused by the frontend driver (Tarea 06)
 * and by the pool/queue scheduler (Tarea 07).
 */
@WebSocketGateway({
  namespace: 'voice',
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
  // Browser audio chunks: ~10–20 KB per 500 ms. 256 KB is comfortable.
  maxHttpBufferSize: 256 * 1024,
})
export class VoiceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly connections = new WeakMap<Socket, VoiceConnection>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly voice: VoiceService,
    private readonly auth: AuthService,
  ) {}

  afterInit(server: Server) {
    server.use((client, next) => {
      void this.authorize(client).then(
        (identity) => {
          this.connections.set(client, {
            ...identity,
            pending: Promise.resolve(),
            queued: 0,
          });
          next();
        },
        () => next(new Error('Voice authorization failed')),
      );
    });
  }

  private async authorize(client: Socket) {
    if (!this.auth.isAuthEnabled()) return { principal: 'standalone' };
    const token =
      client.handshake.auth?.token ??
      client.handshake.headers.authorization?.replace(/^Bearer /, '');
    const { user, expiresAt } = await this.auth.authenticateAccessToken(token);
    if (user.permissions?.[Permission.ASK] !== true) throw new Error();
    return { principal: String(user.id), expiresAt };
  }

  handleConnection(client: Socket) {
    const connection = this.connections.get(client);
    if (!connection) return this.reject(client);
    if (connection.expiresAt !== undefined) {
      connection.expiryTimer = setTimeout(
        () => this.reject(client),
        Math.min(Math.max(0, connection.expiresAt - Date.now()), 2147483647),
      );
      connection.expiryTimer.unref();
    }
  }

  handleDisconnect(client: Socket) {
    const connection = this.connections.get(client);
    if (connection?.expiryTimer) clearTimeout(connection.expiryTimer);
    this.connections.delete(client);
    this.voice.releaseIfHolding(client);
  }

  private reject(client: Socket) {
    this.logger.warn('Voice connection authorization failed');
    client.emit('voice:error', { message: 'Voice session is unavailable' });
    this.handleDisconnect(client);
    client.disconnect(true);
  }

  private authorized(
    client: Socket,
    action: () => void | Promise<void>,
  ): Promise<void> {
    const connection = this.connections.get(client);
    if (!connection || !client.connected || connection.queued >= 32) {
      this.reject(client);
      return Promise.resolve();
    }
    // Preserve audio/control order across asynchronous permission lookups and
    // bound the backlog while a lookup is pending. Never queue worker opening.
    connection.queued++;
    connection.pending = connection.pending
      .then(async () => {
        if (!client.connected || this.connections.get(client) !== connection)
          return;
        const identity = await this.authorize(client);
        if (!client.connected || this.connections.get(client) !== connection)
          return;
        if (identity.principal !== connection.principal) throw new Error();
        await action();
      })
      .catch(() => this.reject(client))
      .finally(() => {
        connection.queued--;
      });
    return connection.pending;
  }

  @SubscribeMessage('voice:start')
  async onStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() input?: { requestId?: string },
  ): Promise<void> {
    if (
      input !== undefined &&
      (!input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== 'requestId') ||
        (input.requestId !== undefined &&
          (typeof input.requestId !== 'string' ||
            !EXECUTION_UUID_PATTERN.test(input.requestId))))
    ) {
      this.reject(client);
      return;
    }
    await this.authorized(client, () =>
      this.voice.startSession(
        client,
        this.connections.get(client).principal,
        input?.requestId,
      ),
    );
  }

  @SubscribeMessage('voice:chunk')
  onChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() chunk: ArrayBuffer | Buffer | { data: ArrayBuffer | Buffer },
  ): Promise<void> {
    // Socket.IO can deliver binary as either ArrayBuffer/Buffer directly or
    // wrapped in `{ type: 'Buffer', data: [...] }` depending on adapter.
    const raw =
      (chunk as { data?: ArrayBuffer | Buffer })?.data ??
      (chunk as ArrayBuffer | Buffer);
    if (
      !(Buffer.isBuffer(raw) || raw instanceof ArrayBuffer) ||
      raw.byteLength > 256 * 1024
    ) {
      this.reject(client);
      return Promise.resolve();
    }
    return this.authorized(client, () => this.voice.pushChunk(client, raw));
  }

  @SubscribeMessage('voice:stop')
  onStop(@ConnectedSocket() client: Socket): Promise<void> {
    return this.authorized(client, () => this.voice.stopSession(client));
  }

  @SubscribeMessage('voice:cancel')
  onCancel(@ConnectedSocket() client: Socket): Promise<void> {
    return this.authorized(client, () => this.voice.cancelSession(client));
  }
}
