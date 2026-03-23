import { Controller, Post, Body } from '@nestjs/common';
import { ModelService } from './model.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('model')
export class ModelController {
  constructor(private readonly modelService: ModelService) { }

  @Post('ask')
  @RequirePermissions(Permission.ASK)
  async askQuestion(@Body() questionData: { question: string; projectId?: number; requestId?: string }): Promise<{ jobId: number }> {
    return this.modelService.ask(questionData.question, questionData.projectId, questionData.requestId);
  }

  @Post('summarize')
  @RequirePermissions(Permission.SUMMARIZE)
  async summarize(
    @Body()
    summarizeData: {
      targetLanguage: string;
      resourceId?: number;
      text?: string;
      targetDocId?: number;
      sourceLanguage?: string;
      type?: string;
    },
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
    @Body()
    translateData: {
      targetLanguage: string;
      resourceId: number;
    },
  ): Promise<void> {
    await this.modelService.translate(
      translateData.resourceId,
      translateData.targetLanguage,
    );
  }

  @Post('extract-entities')
  @RequirePermissions(Permission.ENTITY_EXTRACTION)
  async extractEntities(
    @Body()
    body: { resourceId: number },
  ): Promise<void> {
    await this.modelService.extractEntities(body.resourceId);
  }

  @Post('key-points')
  @RequirePermissions(Permission.KEY_POINTS)
  async keyPoints(
    @Body()
    body: { resourceId: number; targetLanguage?: string },
  ): Promise<void> {
    await this.modelService.keyPoints(body.resourceId, body.targetLanguage);
  }

  @Post('keywords')
  @RequirePermissions(Permission.KEYWORDS)
  async keywords(
    @Body()
    body: { resourceId: number; targetLanguage?: string },
  ): Promise<void> {
    await this.modelService.keywords(body.resourceId, body.targetLanguage);
  }
}
