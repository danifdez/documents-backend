import { Global, Module } from '@nestjs/common';
import { InferenceService } from './inference.service';

@Global()
@Module({
  providers: [InferenceService],
  exports: [InferenceService],
})
export class InferenceModule {}
