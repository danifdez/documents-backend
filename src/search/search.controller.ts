import { Controller, Post, Body } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchResultDto } from './dto/search-result.dto';
import { PageEntitiesDto, PageEntityMatch } from './dto/page-entities.dto';
import { PageBlocksDto, PageBlockResult } from './dto/page-blocks.dto';
import { PageMatchesDto, PageMatchesResult } from './dto/page-matches.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import {
  EvidenceSearchDto,
  EvidenceSearchResultDto,
} from './dto/evidence-search.dto';

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

  @Post('page-matches')
  async pageMatches(@Body() dto: PageMatchesDto): Promise<PageMatchesResult> {
    const [entities, knowledge, timeline, bibliography] = await Promise.all([
      this.searchService.matchEntitiesInText(dto.text, dto.projectId),
      this.searchService.matchKnowledgeInText(dto.text),
      this.searchService.matchTimelineInText(dto.text, dto.projectId),
      this.searchService.matchBibliographyInText(dto.text, dto.projectId),
    ]);
    return { entities, knowledge, timeline, bibliography };
  }

  @RequirePermissions(Permission.ASK)
  @Post('evidence')
  async evidence(
    @Body() dto: EvidenceSearchDto,
  ): Promise<EvidenceSearchResultDto> {
    return await this.searchService.findEvidence(
      dto.query,
      dto.projectId,
      dto.limit,
    );
  }

  @Post('')
  async search(@Body('term') term: string, @Body('projectId') projectId?: number): Promise<SearchResultDto[]> {
    return await this.searchService.globalSearch(term, projectId);
  }
}
