import { Module } from '@nestjs/common';
import { MarkController } from './mark.controller';
import { MarkService } from './mark.service';
import { markProviders } from './mark.providers';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [MarkController],
  providers: [MarkService, ...markProviders],
  exports: [MarkService],
})
export class MarkModule { }
