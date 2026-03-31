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

  async ask(question: string, projectId?: number, requestId?: string): Promise<{ jobId: number }> {
    const job = await this.jobService.create('ask', JobPriority.HIGH, {
      question,
      projectId,
      requestId,
    });
    return { jobId: job.id };
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

    await this.jobService.create('summarize', JobPriority.NORMAL, {
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

    await this.jobService.create('translate', JobPriority.NORMAL, {
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
    await this.jobService.create('entity-extraction', JobPriority.NORMAL, {
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

    await this.jobService.create('key-point', JobPriority.NORMAL, {
      resourceId: resourceId,
      content: content,
      targetLanguage: targetLanguage || resource.language || 'en',
    });
  }

  async keywords(resourceId: number, targetLanguage?: string): Promise<void> {
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

    await this.jobService.create('keywords', JobPriority.NORMAL, {
      resourceId: resourceId,
      content: content,
      targetLanguage: targetLanguage || resource.language || 'en',
    });
  }

  async generateImage(params: {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    guidanceScale?: number;
    seed?: number;
    requestId?: string;
    canvasId?: number;
    projectId?: number;
  }): Promise<{ jobId: number }> {
    const job = await this.jobService.create('image-generate', JobPriority.NORMAL, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      width: params.width || 1024,
      height: params.height || 1024,
      steps: params.steps || 30,
      guidanceScale: params.guidanceScale || 7.5,
      seed: params.seed,
      requestId: params.requestId,
      canvasId: params.canvasId,
      projectId: params.projectId,
    });
    return { jobId: job.id };
  }

  async editImage(params: {
    resourceId: number;
    prompt: string;
    negativePrompt?: string;
    strength?: number;
    steps?: number;
    guidanceScale?: number;
    seed?: number;
    requestId?: string;
    canvasId?: number;
    projectId?: number;
  }): Promise<{ jobId: number }> {
    const resource = await this.resourceService.findOne(params.resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${params.resourceId} not found`);
    }
    if (!resource.hash && !resource.path) {
      throw new Error(`Resource with ID ${params.resourceId} has no file hash or path`);
    }

    // Determine file extension from path
    let sourceExtension = '.png';
    if (resource.path) {
      const lastDot = resource.path.lastIndexOf('.');
      if (lastDot !== -1) {
        sourceExtension = resource.path.substring(lastDot);
      }
    }

    const job = await this.jobService.create('image-edit', JobPriority.NORMAL, {
      sourceHash: resource.hash,
      sourcePath: resource.path,
      sourceExtension,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      strength: params.strength || 0.75,
      steps: params.steps || 30,
      guidanceScale: params.guidanceScale || 7.5,
      seed: params.seed,
      requestId: params.requestId,
      canvasId: params.canvasId,
      projectId: params.projectId,
    });
    return { jobId: job.id };
  }
}
