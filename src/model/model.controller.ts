import { Controller, Post, Body } from '@nestjs/common';
import { ModelService } from './model.service';
import { ExecutionService } from '../execution/execution.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import {
  AskQuestionDto,
  SummarizeDto,
  TranslateDto,
  ExtractEntitiesDto,
  KeyPointsDto,
  KeywordsDto,
  SemanticSearchDto,
} from './dto/model.dto';

@Controller('model')
export class ModelController {
  constructor(
    private readonly modelService: ModelService,
    private readonly executions: ExecutionService,
  ) {}

  @Post('ask')
  @RequirePermissions(Permission.ASK)
  async askQuestion(
    @Body() questionData: AskQuestionDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.ask(
      this.executions.resolveAccessScope(user),
      questionData.question,
      questionData.projectId,
      questionData.requestId,
      questionData.context,
    );
  }

  @Post('summarize')
  @RequirePermissions(Permission.SUMMARIZE)
  async summarize(
    @Body() summarizeData: SummarizeDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.summarize(
      this.executions.resolveAccessScope(user),
      summarizeData.targetLanguage,
      summarizeData.resourceId,
      summarizeData.targetDocId,
      summarizeData.text,
      summarizeData.sourceLanguage,
      summarizeData.type,
    );
  }

  @Post('translate')
  @RequirePermissions(Permission.TRANSLATE)
  async translate(
    @Body() translateData: TranslateDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.translate(
      this.executions.resolveAccessScope(user),
      translateData.resourceId,
      translateData.targetLanguage,
    );
  }

  @Post('extract-entities')
  @RequirePermissions(Permission.ENTITY_EXTRACTION)
  async extractEntities(
    @Body() body: ExtractEntitiesDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.extractEntities(
      this.executions.resolveAccessScope(user),
      body.resourceId,
    );
  }

  @Post('key-points')
  @RequirePermissions(Permission.KEY_POINTS)
  async keyPoints(
    @Body() body: KeyPointsDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.keyPoints(
      this.executions.resolveAccessScope(user),
      body.resourceId,
      body.targetLanguage,
    );
  }

  @Post('keywords')
  @RequirePermissions(Permission.KEYWORDS)
  async keywords(
    @Body() body: KeywordsDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.keywords(
      this.executions.resolveAccessScope(user),
      body.resourceId,
      body.targetLanguage,
    );
  }

  @Post('semantic-search')
  @RequirePermissions(Permission.ASK)
  async semanticSearch(
    @Body() body: SemanticSearchDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.modelService.semanticSearch(
      this.executions.resolveAccessScope(user),
      body.query,
      body.projectId,
      body.requestId,
      body.limit,
    );
  }
}
