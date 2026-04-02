import { Controller, Post, Body } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchResultDto } from './dto/search-result.dto';
import { PageEntitiesDto, PageEntityMatch } from './dto/page-entities.dto';
import { PageBlocksDto, PageBlockResult } from './dto/page-blocks.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) { }

  @Post('page-entities')
  async pageEntities(@Body() dto: PageEntitiesDto): Promise<PageEntityMatch[]> {
    return await this.searchService.matchEntitiesInText(dto.text, dto.projectId);
  }

  @Post('page-blocks')
  async pageBlocks(@Body() dto: PageBlocksDto): Promise<PageBlockResult[]> {
    return await this.searchService.searchBlocks(dto.blocks, dto.projectId);
  }

  @Post('')
  async search(@Body('term') term: string, @Body('projectId') projectId?: number): Promise<SearchResultDto[]> {
    return await this.searchService.globalSearch(term, projectId);
  }
}
