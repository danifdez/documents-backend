import { Connection } from 'mongoose';
import { ResourceSchema } from './resource.schema';

export const resourceProviders = [
  {
    provide: 'RESOURCE_MODEL',
    useFactory: (connection: Connection) =>
      connection.model('Resource', ResourceSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
