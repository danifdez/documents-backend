import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
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
}
