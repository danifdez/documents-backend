import { Connection } from 'mongoose';
import { ThreadSchema } from './thread.schema';

export const threadProviders = [
  {
    provide: 'THREAD_MODEL',
    useFactory: (connection: Connection) => connection.model('Thread', ThreadSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
