import * as mongoose from 'mongoose';
import { ConfigService } from '@nestjs/config';

export const databaseProviders = [
  {
    provide: 'DATABASE_CONNECTION',
    inject: [ConfigService],
    useFactory: async (configService: ConfigService): Promise<typeof mongoose> => {
      const username = configService.get('MONGO_USERNAME');
      const password = configService.get('MONGO_PASSWORD');
      const host = configService.get('MONGO_HOST');
      const port = configService.get('MONGO_PORT');
      const database = configService.get('MONGO_DATABASE');

      const uri = `mongodb://${username}:${password}@${host}:${port}/`;

      return mongoose.connect(uri, { dbName: database });
    },
  },
];
