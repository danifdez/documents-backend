import { Injectable } from '@nestjs/common';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { ExecutionService } from '../execution/execution.service';
import { ResourceService } from '../resource/resource.service';
import { extractTextFromHtml } from '../utils/text';
import { buildSummarizeWorkflowSteps } from './summarize-workflow';
import { buildEntityExtractionWorkflowSteps } from './entity-extraction-workflow';
import { buildKeywordsWorkflowSteps } from './keywords-workflow';
import { buildKeyPointWorkflowSteps } from './key-point-workflow';
import { VectorStoreService } from '../vector/vector-store.service';
import { AgeGraphService } from '../graph/age-graph.service';
import { readFeaturesFromEnv } from '../common/feature-flags';
import { contentHash } from '../execution/execution-canonical';
import { buildTranslateWorkflowSteps } from './translate-workflow';
import { ExecutionAccessScope } from '../execution/execution.types';
import { BrowserInferenceDto } from './dto/browser-inference.dto';

@Injectable()
export class ModelService {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly resourceService: ResourceService,
    private readonly vectorStore: VectorStoreService,
    private readonly graphService: AgeGraphService,
  ) {}

  async browserInference(
    request: BrowserInferenceDto,
    scope: ExecutionAccessScope,
  ): Promise<{ executionId: string }> {
    const execution = await this.executionService.createInference(
      'browser-inference',
      ExecutionPriority.HIGH,
      {
        requestJson: request.requestJson,
        label: request.label,
        detail: request.detail,
      },
      { ownerPrincipal: scope.ownerPrincipal, finalizeOnFailure: true },
    );
    return { executionId: execution.executionId };
  }

  async ask(
    question: string,
    projectId?: number,
    requestId?: string,
    context?: string,
  ): Promise<{ executionId: string }> {
    const graphPromise = readFeaturesFromEnv().relationships
      ? this.graphService.queryNeighborhoodForText(question, projectId)
      : Promise.resolve({ entities: [], relationships: [] });
    const [candidates, graph] = await Promise.all([
      this.vectorStore.workspaceCandidates(projectId),
      graphPromise,
    ]);
    const execution = await this.executionService.createInference(
      'ask',
      ExecutionPriority.HIGH,
      {
        question,
        projectId,
        requestId,
        context,
        graphContext: graph.relationships,
      },
      {
        inputArtifacts: [this.vectorStore.vectorCandidatesArtifact(candidates)],
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

    const steps = buildTranslateWorkflowSteps({
      texts: extractedTexts,
      sourceLanguage,
      targetLanguages: [language],
      responseMode: 'items',
    });
    const execution = await this.executionService.create(
      'translate',
      ExecutionPriority.NORMAL,
      {
        resourceId,
        sourceLanguage,
        targetLanguage: language,
        sourceContentHash: contentHash(content),
      },
      { steps },
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
    const steps = buildEntityExtractionWorkflowSteps(extractedTexts);

    const execution = await this.executionService.create(
      'entity-extraction',
      ExecutionPriority.NORMAL,
      {
        resourceId,
        sourceContentHash: contentHash(content),
        sourceLanguage: resource.language || 'en',
      },
      { steps },
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

    const effectiveTargetLanguage = targetLanguage || resource.language || 'en';
    const steps = buildKeyPointWorkflowSteps(
      extractTextFromHtml(content),
      effectiveTargetLanguage,
    );
    const execution = await this.executionService.create(
      'key-point',
      ExecutionPriority.NORMAL,
      {
        resourceId,
        targetLanguage: effectiveTargetLanguage,
      },
      { steps },
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

    const effectiveTargetLanguage = targetLanguage || resource.language || 'en';
    const steps = buildKeywordsWorkflowSteps(
      extractTextFromHtml(content),
      effectiveTargetLanguage,
    );
    const execution = await this.executionService.create(
      'keywords',
      ExecutionPriority.NORMAL,
      {
        resourceId,
        targetLanguage: effectiveTargetLanguage,
      },
      { steps },
    );
    return { executionId: execution.executionId };
  }

  async semanticSearch(
    query: string,
    projectId?: number,
    requestId?: string,
    limit?: number,
  ): Promise<{ executionId: string }> {
    const candidates = await this.vectorStore.workspaceCandidates(projectId);
    const execution = await this.executionService.create(
      'search',
      ExecutionPriority.HIGH,
      {
        query,
        projectId,
        requestId,
        limit: limit || 10,
      },
      {
        inputArtifacts: [this.vectorStore.vectorCandidatesArtifact(candidates)],
      },
    );
    return { executionId: execution.executionId };
  }
}
