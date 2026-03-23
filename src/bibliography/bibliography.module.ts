import { Module } from '@nestjs/common';
import { BibliographyController } from './bibliography.controller';
import { BibliographyService } from './bibliography.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [BibliographyController],
  providers: [BibliographyService],
  exports: [BibliographyService],
})
export class BibliographyModule { }
