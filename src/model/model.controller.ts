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
      content: string;
      sourceLanguage: string;
      targetLanguage: string;
      resourceId: string;
    },
  ): Promise<void> {
    await this.modelService.summarize(
      summarizeData.content,
      summarizeData.sourceLanguage,
      summarizeData.resourceId,
      summarizeData.targetLanguage,
    );
  }

  @Post('translate')
  async translate(
    @Body()
    translateData: {
      content: string;
      sourceLanguage: string;
      targetLanguage: string;
      resourceId: string;
    },
  ): Promise<void> {
    await this.modelService.translate(
      translateData.content,
      translateData.sourceLanguage,
      translateData.resourceId,
      translateData.targetLanguage,
    );
  }
}
