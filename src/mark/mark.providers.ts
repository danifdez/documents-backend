import { Connection } from 'mongoose';
import { MarkSchema } from './mark.schema';

export const markProviders = [
  {
    provide: 'MARK_MODEL',
    useFactory: (connection: Connection) => connection.model('Mark', MarkSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
