import { Controller, Get, Query } from '@nestjs/common';
import { ReferenceService } from './reference.service';

@Controller('reference')
export class ReferenceController {
  constructor(private readonly referenceService: ReferenceService) {}

  @Get('search')
  async search(@Query('q') query: string) {
    return this.referenceService.search(query);
  }
}
