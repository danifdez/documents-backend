import { Controller, Post, Body } from '@nestjs/common';
import { ModelService } from './model.service';

@Controller('model')
export class ModelController {
  constructor(private readonly modelService: ModelService) { }

  @Post('ask')
  async askQuestion(@Body() questionData: { question: string }): Promise<void> {
    await this.modelService.ask(questionData.question);
  }

  @Post('summarize')
  async summarize(
    @Body()
    summarizeData: {
      targetLanguage: string;
      resourceId: number;
    },
  ): Promise<void> {
    await this.modelService.summarize(
      summarizeData.resourceId,
      summarizeData.targetLanguage,
    );
  }

  @Post('translate')
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
  async extractEntities(
    @Body()
    body: { resourceId: number },
  ): Promise<void> {
    await this.modelService.extractEntities(body.resourceId);
  }
}
