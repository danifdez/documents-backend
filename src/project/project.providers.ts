import { Connection } from 'mongoose';
import { ProjectSchema } from './project.schema';

export const projectProviders = [
  {
    provide: 'PROJECT_MODEL',
    useFactory: (connection: Connection) => connection.model('Project', ProjectSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
