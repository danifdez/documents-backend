import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class NotificationGateway {
  @WebSocketServer()
  server: Server;

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
}
