import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

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
      this.jwtService.verify(token);
    } catch {
      this.logger.warn('WebSocket connection rejected: invalid token');
      client.disconnect(true);
    }
  }

  async publishExecution(message: {
    outboxId: string;
    socketEvent: string;
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    if (!this.server || this.server.sockets.sockets.size === 0) return false;
    const deliveries = await Promise.allSettled(
      Array.from(this.server.sockets.sockets.values()).map((client) =>
        client.timeout(5_000).emitWithAck('execution:publication', message),
      ),
    );
    return deliveries.some(
      (delivery) =>
        delivery.status === 'fulfilled' &&
        delivery.value &&
        typeof delivery.value === 'object' &&
        'accepted' in delivery.value &&
        delivery.value.accepted === true,
    );
  }

  sendAssistantStreamChunk(data: any) {
    this.server.emit('assistantStreamChunk', data);
  }

  sendAssistantToolEvent(data: any) {
    this.server.emit('assistantToolEvent', data);
  }

  sendAgentStreamChunk(data: any) {
    this.server.emit('agentStreamChunk', data);
  }

  sendAgentToolEvent(data: any) {
    this.server.emit('agentToolEvent', data);
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
