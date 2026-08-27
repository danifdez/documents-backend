import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager, In } from 'typeorm';
import { ExecutionArtifactEntity } from '../execution/execution-artifact.entity';
import { canonicalJson, contentHash } from '../execution/execution-canonical';
import {
  ConversationArtifactMessage,
  ConversationArtifactRevisionEntity,
} from './conversation-artifact-revision.entity';
import type { ChatExecutionPayload } from '../execution/execution-task-payload.types';
import { ExecutionArtifactStorageService } from '../execution/execution-artifact-storage.service';
import { derivedArtifactPolicy } from '../execution/execution-artifact-policy';

export const ACTIVE_CONTEXT_ARTIFACT_ROLE = 'active_context';
export const ACTIVE_CONTEXT_SCHEMA = 'active-context/1';
export const CONTINUITY_CAPSULE_SCHEMA = 'continuity-capsule/1';
export const MAX_ACTIVE_CONVERSATION_MESSAGES = 24;
export const MAX_ACTIVE_CONVERSATION_CHARS = 32_000;
export const MAX_ACTIVE_MESSAGE_CHARS = 16_000;
const MAX_CAPSULE_CHARS = 4_000;
const MAX_CAPSULE_MESSAGE_CHARS = 360;
const MAX_ACTIVE_CONTEXT_ARTIFACT_BYTES = 1024 * 1024;

export interface ConversationRevisionPointer {
  artifactId: string;
  revision: number;
  contentHash: string;
}

export interface ContinuityCapsule {
  schemaVersion: typeof CONTINUITY_CAPSULE_SCHEMA;
  sourceConversation: ConversationRevisionPointer;
  omittedMessageCount: number;
  omittedTurnCount: number;
  roleCounts: { user: number; assistant: number };
  firstOmittedAt: string | null;
  lastOmittedAt: string | null;
  truncatedMessageIds: number[];
  digest: string;
}

export interface ActiveConversationContext {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationContext: ConversationRevisionPointer;
  continuityCapsule: ContinuityCapsule | null;
}

export interface ActiveContextSnapshot {
  schemaVersion: typeof ACTIVE_CONTEXT_SCHEMA;
  artifactId: string;
  rootExecutionId: string;
  sessionId: string | null;
  turnId: string | null;
  causedByEventId: string;
  sourceConversation: ConversationRevisionPointer | null;
  layers: {
    stable: Record<string, unknown>;
    contextual: {
      conversation: unknown;
      continuityCapsule: unknown;
      activeMemory: unknown;
      activeCapabilities: unknown;
      activeInputReduction: unknown;
    };
    volatile: Record<string, unknown>;
  };
  effectivePayload: ChatExecutionPayload;
}

export function buildActiveConversationContext(
  revision: ConversationArtifactRevisionEntity,
): ActiveConversationContext {
  const selected: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const omitted: ConversationArtifactMessage[] = [];
  const truncatedMessageIds: number[] = [];
  let usedChars = 0;
  let windowClosed = false;

  for (let index = revision.messages.length - 1; index >= 0; index -= 1) {
    const message = revision.messages[index];
    const clipped = clipContent(message.content, MAX_ACTIVE_MESSAGE_CHARS);
    const fits =
      !windowClosed &&
      selected.length < MAX_ACTIVE_CONVERSATION_MESSAGES &&
      usedChars + clipped.length <= MAX_ACTIVE_CONVERSATION_CHARS;
    if (!fits) {
      windowClosed = true;
      omitted.push(message);
      continue;
    }
    if (clipped !== message.content)
      truncatedMessageIds.push(message.messageId);
    selected.push({ role: message.role, content: clipped });
    usedChars += clipped.length;
  }
  selected.reverse();
  omitted.reverse();

  const sourceConversation = revisionPointer(revision);
  return {
    conversation: selected,
    conversationContext: sourceConversation,
    continuityCapsule:
      omitted.length || truncatedMessageIds.length
        ? buildContinuityCapsule(
            sourceConversation,
            omitted,
            truncatedMessageIds,
          )
        : null,
  };
}

export async function freezeActiveContextArtifact(
  manager: EntityManager,
  artifactStorage: ExecutionArtifactStorageService,
  input: {
    rootExecutionId: string;
    sessionId: string | null;
    turnId: string | null;
    causedByEventId: string;
    effectivePayload: ChatExecutionPayload;
    derivedFromArtifactIds?: string[];
  },
): Promise<ExecutionArtifactEntity> {
  const artifactId = randomUUID();
  const sourceConversation = conversationPointerFromPayload(
    input.effectivePayload,
  );
  const snapshot: ActiveContextSnapshot = {
    schemaVersion: ACTIVE_CONTEXT_SCHEMA,
    artifactId,
    rootExecutionId: input.rootExecutionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    causedByEventId: input.causedByEventId,
    sourceConversation,
    layers: {
      stable: selectPayloadFields(input.effectivePayload, [
        'ownerId',
        'systemPrompt',
        'folderScope',
      ]),
      contextual: {
        conversation: input.effectivePayload.conversation ?? [],
        continuityCapsule: input.effectivePayload.continuityCapsule ?? null,
        activeMemory: input.effectivePayload.activeMemory ?? null,
        activeCapabilities: input.effectivePayload.activeCapabilities ?? null,
        activeInputReduction:
          input.effectivePayload.activeInputReduction ?? null,
      },
      volatile: selectPayloadFields(input.effectivePayload, [
        'toolHistory',
        'delegationMode',
        'runtimeDirective',
      ]),
    },
    effectivePayload: input.effectivePayload,
  };
  const body = Buffer.from(canonicalJson(snapshot), 'utf8');
  if (body.length > MAX_ACTIVE_CONTEXT_ARTIFACT_BYTES) {
    throw new BadRequestException('active_context_too_large');
  }

  const artifactRepo = manager.getRepository(ExecutionArtifactEntity);
  const derivedIds = [...new Set(input.derivedFromArtifactIds ?? [])];
  const derivedArtifacts = derivedIds.length
    ? await artifactRepo.find({
        where: {
          rootExecutionId: input.rootExecutionId,
          artifactId: In(derivedIds),
        },
      })
    : [];
  const policy = derivedArtifactPolicy(derivedArtifacts);
  return artifactStorage.save(manager, {
    artifactId,
    rootExecutionId: input.rootExecutionId,
    kind: ACTIVE_CONTEXT_ARTIFACT_ROLE,
    contentHash: contentHash(body),
    size: String(body.length),
    mediaType: 'application/vnd.documents.active-context+json',
    encoding: 'identity',
    dataClassification: policy.dataClassification,
    redaction: { applied: false },
    retentionClass: policy.retentionClass,
    expiresAt: policy.expiresAt,
    createdByEventId: input.causedByEventId,
    producedByAttemptId: null,
    inputSourceIds: policy.inputSourceIds,
    derivedFromArtifactIds: derivedIds,
    body,
  });
}

function revisionPointer(
  revision: ConversationArtifactRevisionEntity,
): ConversationRevisionPointer {
  return {
    artifactId: revision.artifactId,
    revision: revision.revision,
    contentHash: revision.contentHash,
  };
}

function conversationPointerFromPayload(
  payload: ChatExecutionPayload,
): ConversationRevisionPointer | null {
  const pointer = payload.conversationContext;
  if (!pointer || typeof pointer !== 'object') return null;
  const value = pointer;
  if (
    typeof value.artifactId !== 'string' ||
    !Number.isInteger(value.revision) ||
    typeof value.contentHash !== 'string'
  ) {
    throw new BadRequestException('invalid_conversation_context');
  }
  return value;
}

function selectPayloadFields(
  payload: ChatExecutionPayload,
  keys: Array<keyof ChatExecutionPayload>,
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]]),
  );
}

function buildContinuityCapsule(
  sourceConversation: ConversationRevisionPointer,
  omitted: ConversationArtifactMessage[],
  truncatedMessageIds: number[],
): ContinuityCapsule {
  const digestLines: string[] = [];
  let digestChars = 0;
  for (const message of omitted.slice().reverse()) {
    const excerpt = clipContent(message.content, MAX_CAPSULE_MESSAGE_CHARS);
    const line = `${message.role} [turn ${message.turnId}]: ${excerpt}`;
    const separatorLength = digestLines.length ? 1 : 0;
    if (digestChars + separatorLength + line.length > MAX_CAPSULE_CHARS) break;
    digestLines.unshift(line);
    digestChars += separatorLength + line.length;
  }
  const turns = new Set(omitted.map((message) => message.turnId));
  return {
    schemaVersion: CONTINUITY_CAPSULE_SCHEMA,
    sourceConversation,
    omittedMessageCount: omitted.length,
    omittedTurnCount: turns.size,
    roleCounts: {
      user: omitted.filter((message) => message.role === 'user').length,
      assistant: omitted.filter((message) => message.role === 'assistant')
        .length,
    },
    firstOmittedAt: omitted[0]?.createdAt ?? null,
    lastOmittedAt: omitted.at(-1)?.createdAt ?? null,
    truncatedMessageIds: [...truncatedMessageIds].sort((a, b) => a - b),
    digest:
      digestLines.join('\n') ||
      'No complete messages were omitted; oversized messages were clipped.',
  };
}

function clipContent(content: string, maximum: number): string {
  if (content.length <= maximum) return content;
  const marker = '\n[...content clipped...]\n';
  const remaining = maximum - marker.length;
  const head = Math.ceil(remaining * 0.67);
  return `${content.slice(0, head)}${marker}${content.slice(-(remaining - head))}`;
}
