import { Injectable } from '@nestjs/common';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { ExecutionService } from '../execution/execution.service';
import { ResourceService } from '../resource/resource.service';
import { extractTextFromHtml } from '../utils/text';
import { buildSummarizeWorkflowSteps } from './summarize-workflow';

@Injectable()
export class ModelService {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly resourceService: ResourceService,
  ) {}

  async ask(
    question: string,
    projectId?: number,
    requestId?: string,
    context?: string,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'ask',
      ExecutionPriority.HIGH,
      {
        question,
        projectId,
        requestId,
        context,
      },
    );
    return { executionId: execution.executionId };
  }

  async summarize(
    targetLanguage: string,
    resourceId?: number,
    targetDocId?: number,
    text?: string,
    sourceLanguage?: string,
    type?: string,
  ): Promise<{ executionId: string }> {
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
    if (!content) throw new Error('Summarization content is required');

    const steps = buildSummarizeWorkflowSteps(
      content,
      targetLanguage,
      sourceLanguage,
    );

    const execution = await this.executionService.create(
      'summarize',
      ExecutionPriority.NORMAL,
      {
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        resourceId: resourceId,
        targetDocId: targetDocId,
        type: type || 'resource',
      },
      { steps },
    );
    return { executionId: execution.executionId };
  }

  async translate(
    resourceId: number,
    language: string,
  ): Promise<{ executionId: string }> {
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

    const execution = await this.executionService.create(
      'translate',
      ExecutionPriority.NORMAL,
      {
        resourceId: resourceId,
        sourceLanguage: sourceLanguage,
        targetLanguage: language,
        texts: extractedTexts,
      },
    );
    return { executionId: execution.executionId };
  }

  async extractEntities(resourceId: number): Promise<{ executionId: string }> {
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    const content = await this.resourceService.getContentById(resourceId);
    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

    const extractedTexts = extractTextFromHtml(content);

    const execution = await this.executionService.create(
      'entity-extraction',
      ExecutionPriority.NORMAL,
      {
        resourceId: resourceId,
        from: 'content',
        texts: extractedTexts,
        kind: 'one_shot',
      },
    );
    return { executionId: execution.executionId };
  }

  async keyPoints(
    resourceId: number,
    targetLanguage?: string,
  ): Promise<{ executionId: string }> {
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    // Prefer translated content if available
    let content =
      await this.resourceService.getTranslatedContentById(resourceId);
    if (!content) {
      content = await this.resourceService.getContentById(resourceId);
    }

    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

    const execution = await this.executionService.create(
      'key-point',
      ExecutionPriority.NORMAL,
      {
        resourceId: resourceId,
        content: content,
        targetLanguage: targetLanguage || resource.language || 'en',
      },
    );
    return { executionId: execution.executionId };
  }

  async keywords(
    resourceId: number,
    targetLanguage?: string,
  ): Promise<{ executionId: string }> {
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} not found`);
    }

    // Prefer translated content if available
    let content =
      await this.resourceService.getTranslatedContentById(resourceId);
    if (!content) {
      content = await this.resourceService.getContentById(resourceId);
    }

    if (!content) {
      throw new Error(`Resource with ID ${resourceId} has no content`);
    }

    const execution = await this.executionService.create(
      'keywords',
      ExecutionPriority.NORMAL,
      {
        resourceId: resourceId,
        content: content,
        targetLanguage: targetLanguage || resource.language || 'en',
      },
    );
    return { executionId: execution.executionId };
  }

  async semanticSearch(
    query: string,
    projectId?: number,
    requestId?: string,
    limit?: number,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.create(
      'search',
      ExecutionPriority.HIGH,
      {
        query,
        projectId,
        requestId,
        limit: limit || 10,
      },
    );
    return { executionId: execution.executionId };
  }
}
