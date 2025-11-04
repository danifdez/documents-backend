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
    targetLanguage: string,
    resourceId?: number,
    targetDocId?: number,
    text?: string,
    sourceLanguage?: string,
    type?: string,
  ): Promise<void> {
    let content: string | null = null;
    if (resourceId) {
      const resource = await this.resourceService.findOne(resourceId);
      if (!resource) {
        throw new Error(`Resource with ID ${resourceId} not found`);
      }

      content = await this.resourceService.getContentById(resourceId);
      if (!content) {
        throw new Error(`Resource with ID ${resourceId} has no content`);
      }
      sourceLanguage = resource.language || 'en';
    } else if (type === 'workspace-selection' && text) {
      content = text;
    }

    this.jobService.create('summarize', JobPriority.NORMAL, {
      content: content,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      resourceId: resourceId,
      targetDocId: targetDocId,
      type: type || 'resource',
    });
  }

  async translate(
    resourceId: number,
    language: string,
  ): Promise<void> {
    // Fetch the resource to get content and source language
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    const content = await this.resourceService.getContentById(resourceId);
    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

    const sourceLanguage = resource.language || 'en';
    const extractedTexts = extractTextFromHtml(content);

    this.jobService.create('translate', JobPriority.NORMAL, {
      resourceId: resourceId,
      sourceLanguage: sourceLanguage,
      targetLanguage: language,
      texts: extractedTexts,
    });
  }

  async extractEntities(resourceId: number): Promise<void> {
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    const content = await this.resourceService.getContentById(resourceId);
    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

    const extractedTexts = extractTextFromHtml(content);

    // Create job for entity extraction
    this.jobService.create('entity-extraction', JobPriority.NORMAL, {
      resourceId: resourceId,
      from: 'content',
      texts: extractedTexts,
    });
  }

  async keyPoints(resourceId: number, targetLanguage?: string): Promise<void> {
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    // Prefer translated content if available
    let content = await this.resourceService.getTranslatedContentById(resourceId);
    if (!content) {
      content = await this.resourceService.getContentById(resourceId);
    }

    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

    this.jobService.create('key-point', JobPriority.NORMAL, {
      resourceId: resourceId,
      content: content,
      targetLanguage: targetLanguage || resource.language || 'en',
    });
  }
}
