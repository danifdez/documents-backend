import { Controller, Post, Body } from '@nestjs/common';
import { ModelService } from './model.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import {
  AskQuestionDto, SummarizeDto, TranslateDto, ExtractEntitiesDto,
  KeyPointsDto, KeywordsDto, GenerateImageDto, EditImageDto, SemanticSearchDto,
} from './dto/model.dto';

@Controller('model')
export class ModelController {
  constructor(private readonly modelService: ModelService) { }

  @Post('ask')
  @RequirePermissions(Permission.ASK)
  async askQuestion(@Body() questionData: AskQuestionDto): Promise<{ jobId: number }> {
    return this.modelService.ask(questionData.question, questionData.projectId, questionData.requestId, questionData.context);
  }

  @Post('summarize')
  @RequirePermissions(Permission.SUMMARIZE)
  async summarize(
    @Body() summarizeData: SummarizeDto,
  ): Promise<void> {
    await this.modelService.summarize(
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
  ): Promise<void> {
    await this.modelService.translate(
      translateData.resourceId,
      translateData.targetLanguage,
    );
  }

  @Post('extract-entities')
  @RequirePermissions(Permission.ENTITY_EXTRACTION)
  async extractEntities(
    @Body() body: ExtractEntitiesDto,
  ): Promise<void> {
    await this.modelService.extractEntities(body.resourceId);
  }

  @Post('key-points')
  @RequirePermissions(Permission.KEY_POINTS)
  async keyPoints(
    @Body() body: KeyPointsDto,
  ): Promise<void> {
    await this.modelService.keyPoints(body.resourceId, body.targetLanguage);
  }

  @Post('keywords')
  @RequirePermissions(Permission.KEYWORDS)
  async keywords(
    @Body() body: KeywordsDto,
  ): Promise<void> {
    await this.modelService.keywords(body.resourceId, body.targetLanguage);
  }

  @Post('image-generate')
  @RequirePermissions(Permission.IMAGE_GENERATE)
  async generateImage(
    @Body() body: GenerateImageDto,
  ): Promise<{ jobId: number }> {
    return this.modelService.generateImage(body);
  }

  @Post('image-edit')
  @RequirePermissions(Permission.IMAGE_GENERATE)
  async editImage(
    @Body() body: EditImageDto,
  ): Promise<{ jobId: number }> {
    return this.modelService.editImage(body);
  }

  @Post('semantic-search')
  @RequirePermissions(Permission.ASK)
  async semanticSearch(@Body() body: SemanticSearchDto): Promise<{ jobId: number }> {
    return this.modelService.semanticSearch(body.query, body.projectId, body.requestId, body.limit);
  }
}
