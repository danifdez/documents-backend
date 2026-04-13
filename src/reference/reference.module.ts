import { Module, forwardRef } from '@nestjs/common';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';
import { ResourceModule } from '../resource/resource.module';
import { MarkModule } from '../mark/mark.module';
import { DocModule } from '../doc/doc.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { BibliographyModule } from '../bibliography/bibliography.module';

@Module({
  imports: [
    forwardRef(() => ResourceModule),
    forwardRef(() => MarkModule),
    DocModule,
    KnowledgeBaseModule,
    BibliographyModule,
  ],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService, ReferenceModule],
})
export class ReferenceModule { }
