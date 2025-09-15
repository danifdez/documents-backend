import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DocModule } from 'src/doc/doc.module';
import { MarkModule } from 'src/mark/mark.module';
import { ResourceModule } from 'src/resource/resource.module';

@Module({
  imports: [DatabaseModule, DocModule, MarkModule, ResourceModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
