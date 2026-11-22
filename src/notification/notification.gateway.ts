import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ownerPrincipalFromUser } from '../auth/owner-principal';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class NotificationGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    const authEnabled = this.configService.get('AUTH_ENABLED') === 'true';
    if (!authEnabled) {
      client.join(this.executionRoom('standalone'));
      return;
    }

    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn('WebSocket connection rejected: no token provided');
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      const principal = ownerPrincipalFromUser(payload, '');
      if (!principal) throw new Error('Missing user principal');
      client.join(this.executionRoom(principal));
    } catch {
      this.logger.warn('WebSocket connection rejected: invalid token');
      client.disconnect(true);
    }
  }

  private executionRoom(ownerPrincipal: string): string {
    return `execution-owner:${ownerPrincipal}`;
  }

  async publishExecution(
    ownerPrincipal: string,
    message: {
      outboxId: string;
      socketEvent: string;
      payload: Record<string, unknown>;
    },
  ): Promise<boolean> {
    if (!this.server) return false;

    const room = this.executionRoom(ownerPrincipal);
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    if (roomSize === 0) return false;

    try {
      const responses = await (
        this.server.to(room).timeout(5_000) as unknown as {
          emitWithAck: (event: string, payload: unknown) => Promise<unknown>;
        }
      ).emitWithAck('execution:publication', message);
      const deliveries = Array.isArray(responses) ? responses : [responses];
      return deliveries.some(
        (delivery) =>
          delivery &&
          typeof delivery === 'object' &&
          'accepted' in delivery &&
          (delivery as { accepted?: unknown }).accepted === true,
      );
    } catch (error) {
      this.logger.warn(
        `Execution publication ${message.outboxId} failed: ${
          error instanceof Error ? error.message : 'timeout'
        }`,
      );
      return false;
    }
  }

  sendCalendarAlarm(data: {
    eventId: number;
    occurrenceStart: string;
    title: string;
    alarmLabel: string | null;
    trackCompletion: boolean;
  }) {
    this.server.emit('calendar:alarm', data);
  }

  sendCalendarMissed(data: {
    items: Array<{
      eventId: number;
      occurrenceStart: string;
      title: string;
      alarmLabel: string | null;
      trackCompletion: boolean;
    }>;
  }) {
    this.server.emit('calendar:missed', data);
  }

  sendTaskReminder(data: {
    taskId: number;
    title: string;
    reminderAt: string;
  }) {
    this.server.emit('task:reminder', data);
  }

  sendTaskMissed(data: {
    items: Array<{ taskId: number; title: string; reminderAt: string }>;
  }) {
    this.server.emit('task:missed', data);
  }
}
