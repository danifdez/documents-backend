import { Module } from '@nestjs/common';
import { ThreadController } from './thread.controller';
import { ThreadService } from './thread.service';
import { threadProviders } from './thread.providers';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ThreadController],
  providers: [ThreadService, ...threadProviders],
  exports: [ThreadService],
})
export class ThreadModule { }
