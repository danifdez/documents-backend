import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RagClientService } from './rag-client.service';

@Module({
  imports: [HttpModule],
  providers: [RagClientService],
  exports: [RagClientService],
})
export class RagModule { }