import { Injectable } from '@nestjs/common';
import { JobPriority } from 'src/job/job-priority.enum';
import { JobService } from 'src/job/job.service';
import { ResourceService } from 'src/resource/resource.service';
import { extractTextFromHtml } from 'src/utils/text';

@Injectable()
export class ModelService {
  constructor(
    private readonly jobService: JobService,
    private readonly resourceService: ResourceService,
  ) { }

  async ask(question: string): Promise<void> {
    this.jobService.create('ask', JobPriority.HIGH, {
      question,
    });
  }


  async summarize(
    resourceId: number,
    language: string,
  ): Promise<void> {
    // Fetch the resource to get content and source language
    const resource = await this.resourceService.findOne(resourceId);
    const content = await this.resourceService.getContentById(resourceId);
    if (!content) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    const sourceLanguage = resource.language || 'en';
    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

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
}
