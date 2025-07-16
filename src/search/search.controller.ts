import { Controller, Post, Body } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) { }

  @Post('')
  async search(@Body('term') term: string): Promise<any[]> {
    return await this.searchService.globalSearch(term);
  }
}
