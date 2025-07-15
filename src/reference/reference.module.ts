import { Module, forwardRef } from '@nestjs/common';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';
import { ResourceModule } from '../resource/resource.module';
import { MarkModule } from '../mark/mark.module';

@Module({
  imports: [forwardRef(() => ResourceModule), forwardRef(() => MarkModule)],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService, ReferenceModule],
})
export class ReferenceModule { }
