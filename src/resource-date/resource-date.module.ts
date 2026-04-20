import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ResourceDateService } from './resource-date.service';
import { ResourceDateController } from './resource-date.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ResourceDateController],
  providers: [ResourceDateService],
  exports: [ResourceDateService],
})
export class ResourceDateModule {}
