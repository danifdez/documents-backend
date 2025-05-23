import { Module } from '@nestjs/common';
import { DocController } from './doc.controller';
import { DocService } from './doc.service';
import { docProviders } from './doc.providers';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [DocController],
  providers: [DocService, ...docProviders],
  exports: [DocService],
})
export class DocModule { }
