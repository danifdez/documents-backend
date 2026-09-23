import { Global, Module } from '@nestjs/common';
import { FeatureFlagService } from './feature-flags.service';
import { FeatureFlagController } from './feature-flags.controller';
import { AppStateModule } from '../app-state/app-state.module';
import { WorkerModule } from '../worker/worker.module';

@Global()
@Module({
  imports: [AppStateModule, WorkerModule],
  controllers: [FeatureFlagController],
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
