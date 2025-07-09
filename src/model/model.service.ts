import { Injectable } from '@nestjs/common';
import { JobPriority } from 'src/job/job.interface';
import { JobService } from 'src/job/job.service';

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
    resourceId: string,
  ): Promise<void> {
    this.jobService.create('summarize', JobPriority.NORMAL, {
      content: content,
      sourceLanguage: sourceLanguage,
      targetLanguage: 'es',
      resourceId: resourceId,
    });
  }
}
