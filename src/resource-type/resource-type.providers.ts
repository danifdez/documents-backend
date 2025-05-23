import { Connection } from 'mongoose';
import { ResourceTypeSchema } from './resource-type.schema';

export const resourceTypeProviders = [
  {
    provide: 'RESOURCE_TYPE_MODEL',
    useFactory: (connection: Connection) =>
      connection.model('ResourceType', ResourceTypeSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
