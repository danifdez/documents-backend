import { Injectable } from '@nestjs/common';
import { JobPriority } from 'src/job/job-priority.enum';
import { JobService } from 'src/job/job.service';
import { extractTextFromHtml } from 'src/utils/text';

@Injectable()
export class ModelService {
  constructor(private readonly jobService: JobService) { }

  async ask(question: string): Promise<void> {
    this.jobService.create('ask', JobPriority.HIGH, {
      question,
    });
  }


  async summarize(
    content: string,
    sourceLanguage: string,
    resourceId: number,
    language: string,
  ): Promise<void> {
    this.jobService.create('summarize', JobPriority.NORMAL, {
      content: content,
      sourceLanguage: sourceLanguage,
      targetLanguage: language,
      resourceId: resourceId,
    });
  }

  async translate(
    content: string,
    sourceLanguage: string,
    resourceId: number,
    language: string,
  ): Promise<void> {
    const extractedTexts = extractTextFromHtml(content);

    this.jobService.create('translate', JobPriority.NORMAL, {
      resourceId: resourceId,
      sourceLanguage: sourceLanguage,
      targetLanguage: language,
      texts: extractedTexts,
    });
  }

  async keyPoints(document: string, resourceId: number): Promise<void> {
    this.jobService.create('key_points', JobPriority.NORMAL, {
      document,
      resourceId,
    });
  }
}
