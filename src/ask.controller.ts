import { Body, Controller, Post } from '@nestjs/common';
import { RagClientService } from './rag/rag-client.service';

class AskDto {
  question: string;
}

@Controller('ask')
export class AskController {
  constructor(private readonly ragClient: RagClientService) { }

  @Post()
  async ask(@Body() askDto: AskDto) {
    return this.ragClient.post('ask', askDto);
  }
}
