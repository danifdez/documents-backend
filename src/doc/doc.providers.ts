import { Connection } from 'mongoose';
import { DocSchema } from './doc.schema';

export const docProviders = [
  {
    provide: 'DOCUMENT_MODEL',
    useFactory: (connection: Connection) => connection.model('Doc', DocSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
