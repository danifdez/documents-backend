import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { canonicalJson, contentHash } from '../execution/execution-canonical';
import { ExecutionArtifactEntity } from '../execution/execution-artifact.entity';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';
import {
  ChatExecutionPayload,
  executionTaskWork,
} from '../execution/execution-task-payload.types';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { ExecutionArtifactStorageService } from '../execution/execution-artifact-storage.service';
import { derivedArtifactPolicy } from '../execution/execution-artifact-policy';
import { MAX_ACTIVE_MESSAGE_CHARS } from './conversation-context';
import { MAX_CHAT_MESSAGE_CHARS } from './conversation.constants';

export const CONTEXT_CHUNK_PLAN_SCHEMA = 'context-chunk-plan/1';
export const ACTIVE_INPUT_REDUCTION_SCHEMA = 'active-input-reduction/1';
export const CONTEXT_INPUT_MAP_TASK = 'context-input-map';
export const CONTEXT_INPUT_REDUCE_TASK = 'context-input-reduce';
export const CONTEXT_INPUT_FINAL_COORDINATION =
  'context-input-final/1' as const;

const MAX_CHUNK_CHARS = 12_000;
const MIN_BOUNDARY_SEARCH_CHARS = 7_200;
const REDUCTION_FAN_IN = 8;
const HIGH_PRIORITY = 100;

interface ContextChunk {
  index: number;
  start: number;
  end: number;
  contentHash: string;
  content: string;
}

export interface ContextChunkPlan {
  schemaVersion: typeof CONTEXT_CHUNK_PLAN_SCHEMA;
  sourceArtifact: {
    artifactId: string;
    contentHash: string;
    size: number;
  };
  algorithm: 'deterministic-text-boundaries/1';
  offsetUnit: 'utf16-code-unit';
  maxChunkChars: number;
  reductionFanIn: number;
  chunks: Array<Omit<ContextChunk, 'content'>>;
}

export interface ContextInputWorkflow {
  planArtifact: ExecutionArtifactEntity;
  steps: Array<Omit<CreateExecutionStepInput, 'executionId'>>;
}

export async function buildContextInputWorkflow(
  manager: EntityManager,
  artifactStorage: ExecutionArtifactStorageService,
  input: {
    executionId: string;
    taskType: 'assistant-chat' | 'agent-chat';
    message: string;
    requestArtifact: ExecutionArtifactEntity;
    effectivePayload: ChatExecutionPayload;
    causedByEventId: string;
  },
): Promise<ContextInputWorkflow | null> {
  if (input.message.length <= MAX_ACTIVE_MESSAGE_CHARS) return null;
  if (input.message.length > MAX_CHAT_MESSAGE_CHARS) {
    throw new BadRequestException('chat_message_too_large');
  }

  const chunks = chunkMessage(input.message);
  const planArtifactId = randomUUID();
  const plan: ContextChunkPlan = {
    schemaVersion: CONTEXT_CHUNK_PLAN_SCHEMA,
    sourceArtifact: {
      artifactId: input.requestArtifact.artifactId,
      contentHash: input.requestArtifact.contentHash,
      size: Number(input.requestArtifact.size),
    },
    algorithm: 'deterministic-text-boundaries/1',
    offsetUnit: 'utf16-code-unit',
    maxChunkChars: MAX_CHUNK_CHARS,
    reductionFanIn: REDUCTION_FAN_IN,
    chunks: chunks.map(({ index, start, end, contentHash: hash }) => ({
      index,
      start,
      end,
      contentHash: hash,
    })),
  };
  const planBody = Buffer.from(canonicalJson(plan), 'utf8');
  const planPolicy = derivedArtifactPolicy([input.requestArtifact]);
  const planArtifact = await artifactStorage.save(manager, {
    artifactId: planArtifactId,
    rootExecutionId: input.requestArtifact.rootExecutionId,
    kind: 'context_chunk_plan',
    contentHash: contentHash(planBody),
    size: String(planBody.length),
    mediaType: 'application/vnd.documents.context-chunk-plan+json',
    encoding: 'identity',
    dataClassification: planPolicy.dataClassification,
    redaction: { applied: false },
    retentionClass: planPolicy.retentionClass,
    expiresAt: planPolicy.expiresAt,
    createdByEventId: input.causedByEventId,
    producedByAttemptId: null,
    inputSourceIds: planPolicy.inputSourceIds,
    derivedFromArtifactIds: planPolicy.derivedFromArtifactIds,
    body: planBody,
  });

  const mapSteps = chunks.map((chunk) => ({
    stepId: randomUUID(),
    stepKind: ExecutionStepKind.INFERENCE,
    inputArtifactRefs: [
      { role: 'context_chunk_plan', artifactId: planArtifactId },
    ],
    work: {
      ...executionTaskWork(CONTEXT_INPUT_MAP_TASK, {
        planArtifactId,
        chunkIndex: chunk.index,
        start: chunk.start,
        end: chunk.end,
        contentHash: chunk.contentHash,
        content: chunk.content,
      }),
    },
    requiredCapabilities: [CONTEXT_INPUT_MAP_TASK],
    priority: HIGH_PRIORITY,
    causedByEventId: input.causedByEventId,
  }));

  const steps: Array<Omit<CreateExecutionStepInput, 'executionId'>> = [
    ...mapSteps,
  ];
  let level = 1;
  let currentStepIds: string[] = mapSteps.map((step) => step.stepId);
  while (currentStepIds.length > 1) {
    const nextStepIds: string[] = [];
    for (
      let index = 0;
      index < currentStepIds.length;
      index += REDUCTION_FAN_IN
    ) {
      const dependencyIds = currentStepIds.slice(
        index,
        index + REDUCTION_FAN_IN,
      );
      const stepId = randomUUID();
      steps.push({
        stepId,
        stepKind: ExecutionStepKind.INFERENCE,
        dependsOnStepIds: dependencyIds,
        inputArtifactRefs: [
          { role: 'context_chunk_plan', artifactId: planArtifactId },
        ],
        work: {
          ...executionTaskWork(CONTEXT_INPUT_REDUCE_TASK, {
            planArtifactId,
            level,
            groupIndex: nextStepIds.length,
          }),
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds: dependencyIds,
            resultKey: 'digest',
          },
        },
        requiredCapabilities: [CONTEXT_INPUT_REDUCE_TASK],
        priority: HIGH_PRIORITY,
        causedByEventId: input.causedByEventId,
      });
      nextStepIds.push(stepId);
    }
    currentStepIds = nextStepIds;
    level += 1;
  }

  const finalReductionStepId = currentStepIds[0] ?? mapSteps[0].stepId;
  steps.push({
    stepKind: ExecutionStepKind.INFERENCE,
    dependsOnStepIds: [finalReductionStepId],
    inputArtifactRefs: [
      { role: 'user_message', artifactId: input.requestArtifact.artifactId },
      { role: 'context_chunk_plan', artifactId: planArtifactId },
    ],
    work: {
      ...executionTaskWork(input.taskType, input.effectivePayload),
      agentLoop: {
        schemaVersion: 'agent-inference/1',
        purpose: 'normal',
        phase: 'agent_loop',
        sourceStepId: finalReductionStepId,
        evidenceStepIds: [finalReductionStepId],
      },
      coordination: {
        kind: CONTEXT_INPUT_FINAL_COORDINATION,
        reductionStepId: finalReductionStepId,
        resultKey: 'digest',
        planArtifactId,
        sourceArtifactId: input.requestArtifact.artifactId,
      },
    },
    requiredCapabilities: [input.taskType],
    priority: HIGH_PRIORITY,
    causedByEventId: input.causedByEventId,
  });
  return { planArtifact, steps };
}

function chunkMessage(message: string): ContextChunk[] {
  const chunks: ContextChunk[] = [];
  let start = 0;
  while (start < message.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, message.length);
    if (end < message.length) {
      const searchStart = start + MIN_BOUNDARY_SEARCH_CHARS;
      const boundary = Math.max(
        message.lastIndexOf('\n', end),
        message.lastIndexOf(' ', end),
      );
      if (boundary >= searchStart) end = boundary + 1;
    }
    const content = message.slice(start, end);
    chunks.push({
      index: chunks.length,
      start,
      end,
      contentHash: contentHash(Buffer.from(content, 'utf8')),
      content,
    });
    start = end;
  }
  return chunks;
}
