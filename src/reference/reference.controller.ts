import { Controller, Get, Query } from '@nestjs/common';
import { ReferenceService } from './reference.service';

@Controller('reference')
export class ReferenceController {
  constructor(private readonly referenceService: ReferenceService) { }

  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('type') type?: string,
  ) {
    const types = type ? type.split(',').map(t => t.trim()) : undefined;
    return this.referenceService.search(query, types);
  }
}
