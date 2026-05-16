import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { VoiceService } from './voice.service';

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
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly voice: VoiceService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) { }

  handleConnection(client: Socket) {
    const authEnabled = this.config.get('AUTH_ENABLED') === 'true';
    if (!authEnabled) return;

    const token =
      client.handshake.auth?.token ||
      (client.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn('Voice WS rejected: no token');
      client.disconnect(true);
      return;
    }

    try {
      this.jwt.verify(token);
    } catch {
      this.logger.warn('Voice WS rejected: invalid token');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.voice.releaseIfHolding(client);
  }

  @SubscribeMessage('voice:start')
  async onStart(@ConnectedSocket() client: Socket): Promise<void> {
    const ok = await this.voice.startSession(client);
    if (!ok) {
      client.emit('voice:error', { message: 'busy' });
    }
  }

  @SubscribeMessage('voice:chunk')
  onChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() chunk: ArrayBuffer | Buffer | { data: ArrayBuffer | Buffer },
  ): void {
    // Socket.IO can deliver binary as either ArrayBuffer/Buffer directly or
    // wrapped in `{ type: 'Buffer', data: [...] }` depending on adapter.
    const raw = (chunk as { data?: ArrayBuffer | Buffer })?.data ?? (chunk as ArrayBuffer | Buffer);
    this.voice.pushChunk(client, raw);
  }

  @SubscribeMessage('voice:stop')
  onStop(@ConnectedSocket() client: Socket): void {
    this.voice.stopSession(client);
  }

  @SubscribeMessage('voice:cancel')
  onCancel(@ConnectedSocket() client: Socket): void {
    this.voice.cancelSession(client);
  }
}
