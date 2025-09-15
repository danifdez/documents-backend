import { Controller, Post, Body } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchResultDto } from './dto/search-result.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('')
  async search(@Body('term') term: string): Promise<SearchResultDto[]> {
    return await this.searchService.globalSearch(term);
  }
}
