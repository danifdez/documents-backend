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
      resourceId: string;
    },
  ): Promise<void> {
    await this.modelService.summarize(
      summarizeData.content,
      summarizeData.sourceLanguage,
      summarizeData.resourceId,
    );
  }
}
