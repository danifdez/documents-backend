import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
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
  ) { }

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

  sendNotification(data: any) {
    this.server.emit('notification', data);
  }

  sendAskResponse(data: any) {
    this.server.emit('askResponse', data);
  }

  sendImageGenerateResponse(data: any) {
    this.server.emit('imageGenerateResponse', data);
  }

  sendImageEditResponse(data: any) {
    this.server.emit('imageEditResponse', data);
  }

  sendRelationshipExtractionComplete(data: any) {
    this.server.emit('relationshipExtractionComplete', data);
  }

  sendRelationshipQueryResponse(data: any) {
    this.server.emit('relationshipQueryResponse', data);
  }

  sendRelationshipModifyResponse(data: any) {
    this.server.emit('relationshipModifyResponse', data);
  }
}
