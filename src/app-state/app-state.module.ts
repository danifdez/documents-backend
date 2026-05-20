import { Module } from '@nestjs/common';
import { AppStateService } from './app-state.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [AppStateService],
  exports: [AppStateService],
})
export class AppStateModule { }
