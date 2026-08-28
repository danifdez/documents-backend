import { BadRequestException, Injectable } from '@nestjs/common';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import { contentHash } from './execution-canonical';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import {
  DeterministicPartialResult,
  ExecutionCompletion,
} from './execution.types';

export interface ExecutionCompletionValidation {
  execution: ExecutionEntity;
  events: ExecutionEventEntity[];
  artifacts: ExecutionArtifactEntity[];
  safeReply: string;
  error: string | null;
  completion?: ExecutionCompletion;
}

@Injectable()
export class ExecutionCompletionValidator {
  validate(input: ExecutionCompletionValidation): void {
    this.assertLoopDetectedCompletion(
      input.execution,
      input.events,
      input.error,
      input.completion,
    );
    this.assertDeterministicPartial(
      input.execution,
      input.events,
      input.artifacts,
      input.safeReply,
      input.error,
      input.completion,
    );
  }

  private assertDeterministicPartial(
    execution: ExecutionEntity,
    rows: ExecutionEventEntity[],
    artifacts: ExecutionArtifactEntity[],
    safeReply: string,
    error: string | null,
    completion?: ExecutionCompletion,
  ): void {
    if (completion?.source !== 'runtime_template') {
      if (completion?.partialResult) {
        throw new BadRequestException(
          'partialResult requires completionSource=runtime_template',
        );
      }
      return;
    }
    if (
      error ||
      completion.kind !== 'partial' ||
      !['partial_budget_exhausted', 'partial_loop_guard'].includes(
        String(completion.reason),
      )
    ) {
      throw new BadRequestException(
        'Runtime template completion must be a supported successful partial',
      );
    }
    const partial = completion.partialResult;
    if (!partial) {
      throw new BadRequestException(
        'Runtime template completion requires partialResult',
      );
    }
    this.assertPartialShape(partial);

    const finalMessages = rows.filter((row) => {
      const envelope = row.envelope as Record<string, any>;
      const payload = envelope['payload'] as Record<string, any> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'message.recorded' &&
        payload?.['messageKind'] === 'final_response' &&
        payload?.['generationSource'] === 'runtime_template' &&
        (envelope['actor'] as Record<string, any> | undefined)?.['type'] ===
          'system'
      );
    });
    if (finalMessages.length !== 1) {
      throw new BadRequestException(
        'Runtime template requires one correctly attributed final message',
      );
    }
    const finalMessage = finalMessages[0];
    const finalPayload = finalMessage.envelope['payload'] as Record<
      string,
      unknown
    >;
    const artifactId = finalPayload['contentArtifactId'];
    const artifactRefs = finalMessage.envelope['artifactRefs'];
    const artifact = artifacts.find((item) => item.artifactId === artifactId);
    if (
      typeof artifactId !== 'string' ||
      !Array.isArray(artifactRefs) ||
      !artifactRefs.includes(artifactId) ||
      finalPayload['contentPreview'] !== safeReply.slice(0, 512) ||
      !artifact ||
      artifact.rootExecutionId !== execution.rootExecutionId ||
      artifact.kind !== 'model_response' ||
      artifact.mediaType !== 'text/plain' ||
      !artifact.body ||
      artifact.body.toString('utf8') !== safeReply ||
      artifact.contentHash !== contentHash(Buffer.from(safeReply, 'utf8')) ||
      Number(artifact.size) !== Buffer.byteLength(safeReply, 'utf8')
    ) {
      throw new BadRequestException(
        'Runtime template final artifact differs from the completed reply',
      );
    }

    const operationIds = new Set<string>();
    let previousSequence = -1;
    for (const item of partial.completedOperations) {
      if (operationIds.has(item.operationId)) {
        throw new BadRequestException(
          'Duplicate deterministic partial operation',
        );
      }
      operationIds.add(item.operationId);
      const finish = rows.find(
        (row) =>
          row.executionId === execution.executionId &&
          row.operationId === item.operationId &&
          row.eventType === 'operation.finished',
      );
      const start = rows.find(
        (row) =>
          row.executionId === execution.executionId &&
          row.operationId === item.operationId &&
          row.eventType === 'operation.started',
      );
      const finishEnvelope = finish?.envelope as
        Record<string, any> | undefined;
      const startEnvelope = start?.envelope as Record<string, any> | undefined;
      const finishPayload = finishEnvelope?.['payload'] as
        Record<string, any> | undefined;
      const startPayload = startEnvelope?.['payload'] as
        Record<string, any> | undefined;
      if (
        !finish ||
        !start ||
        finishPayload?.['operationKind'] !== 'tool_call' ||
        finishPayload?.['status'] !== 'succeeded' ||
        finishPayload?.['resultSummaryKind'] !== 'leaf_tool' ||
        finishPayload?.['resultSummary'] !== item.summary ||
        startPayload?.['name'] !== item.name ||
        startPayload?.['loopKind'] !== 'top_level' ||
        startPayload?.['loopId'] !== partial.loopId ||
        startPayload?.['budgetGrantId'] !== partial.grantId ||
        startEnvelope?.['toolCallId'] !== item.toolCallId
      ) {
        throw new BadRequestException(
          `Invalid deterministic partial operation ${item.operationId}`,
        );
      }
      const sequence = Number(finish.sequence);
      if (sequence <= previousSequence) {
        throw new BadRequestException(
          'Deterministic partial operations are not in durable order',
        );
      }
      previousSequence = sequence;
    }

    const loopStarts = rows.filter((row) => {
      const envelope = row.envelope as Record<string, any>;
      const payload = envelope['payload'] as Record<string, any> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'operation.started' &&
        payload?.['operationKind'] === 'tool_call' &&
        payload?.['loopId'] === partial.loopId &&
        payload?.['budgetGrantId'] === partial.grantId
      );
    });
    for (const start of loopStarts) {
      const finish = rows.find(
        (row) =>
          row.executionId === execution.executionId &&
          row.operationId === start.operationId &&
          row.eventType === 'operation.finished',
      );
      const payload = finish?.envelope['payload'] as
        Record<string, any> | undefined;
      if (
        !finish ||
        ['dispatched', 'unknown'].includes(String(payload?.['status']))
      ) {
        throw new BadRequestException(
          'Runtime template completion has an ambiguous tool operation',
        );
      }
    }
    if (partial.trigger === 'exact_tool_repeat_persisted') {
      const termination = rows.some((row) => {
        const payload = row.envelope['payload'] as
          Record<string, any> | undefined;
        const signal = payload?.['loopGuardSignal'] as
          Record<string, any> | undefined;
        return (
          row.executionId === execution.executionId &&
          row.eventType === 'progress.reported' &&
          payload?.['kind'] === 'loop_guard_triggered' &&
          signal?.['action'] === 'terminate' &&
          signal?.['grantId'] === partial.grantId &&
          signal?.['loopId'] === partial.loopId
        );
      });
      if (!termination) {
        throw new BadRequestException(
          'Runtime template loop termination is not durable',
        );
      }
    } else if (partial.trigger === 'closing_output_empty') {
      const closingStart = rows.find((row) => {
        const payload = row.envelope['payload'] as
          Record<string, any> | undefined;
        return (
          row.executionId === execution.executionId &&
          row.eventType === 'operation.started' &&
          payload?.['operationKind'] === 'inference' &&
          payload?.['phase'] === 'forced_finalization' &&
          payload?.['loopId'] === partial.loopId &&
          payload?.['budgetGrantId'] === partial.grantId
        );
      });
      const closingFinish = closingStart
        ? rows.find((row) => {
            const payload = row.envelope['payload'] as
              Record<string, any> | undefined;
            return (
              row.executionId === execution.executionId &&
              row.operationId === closingStart.operationId &&
              row.eventType === 'operation.finished' &&
              payload?.['operationKind'] === 'inference' &&
              payload?.['outcome'] === 'invalid' &&
              payload?.['reason'] === 'empty_model_response'
            );
          })
        : undefined;
      if (!closingStart || !closingFinish) {
        throw new BadRequestException(
          'Runtime template closing output was not durably invalid',
        );
      }
    } else {
      const closingUnavailable = rows.some((row) => {
        const payload = row.envelope['payload'] as
          Record<string, any> | undefined;
        const reservation = payload?.['reservation'] as
          Record<string, any> | undefined;
        const grant = payload?.['grant'] as Record<string, any> | undefined;
        return (
          row.executionId === execution.executionId &&
          ((row.eventType === 'progress.reported' &&
            payload?.['kind'] === 'budget_reservation' &&
            reservation?.['grantId'] === partial.grantId &&
            reservation?.['bucket'] === 'closing' &&
            reservation?.['status'] === 'denied') ||
            (row.eventType === 'progress.reported' &&
              payload?.['kind'] === 'budget_grant' &&
              grant?.['grantId'] === partial.grantId &&
              Number(grant?.['effectivePolicy']?.['closing']) === 0))
        );
      });
      if (!closingUnavailable) {
        throw new BadRequestException(
          'Runtime template closing unavailability is not durable',
        );
      }
    }
  }

  private assertPartialShape(partial: DeterministicPartialResult): void {
    if (
      partial.version !== '1' ||
      ![
        'closing_unavailable',
        'closing_output_empty',
        'exact_tool_repeat_persisted',
      ].includes(partial.trigger) ||
      !EXECUTION_UUID_PATTERN.test(partial.loopId) ||
      !EXECUTION_UUID_PATTERN.test(partial.grantId) ||
      !Array.isArray(partial.completedOperations) ||
      partial.completedOperations.length === 0 ||
      !Array.isArray(partial.pending) ||
      partial.pending.length !== 1
    ) {
      throw new BadRequestException('Invalid deterministic partial result');
    }
    const loopPartial = partial.trigger === 'exact_tool_repeat_persisted';
    if (
      (loopPartial &&
        (partial.pending[0] !== 'strategy_change' ||
          partial.continuation?.kind !== 'new_turn' ||
          partial.continuation.reason !== 'different_strategy_required')) ||
      (!loopPartial &&
        (partial.pending[0] !== 'final_synthesis' ||
          partial.continuation !== undefined))
    ) {
      throw new BadRequestException('Invalid deterministic partial result');
    }
    for (const item of partial.completedOperations) {
      if (
        !item ||
        !EXECUTION_UUID_PATTERN.test(item.operationId) ||
        !EXECUTION_UUID_PATTERN.test(item.toolCallId) ||
        !item.name ||
        !item.summary ||
        item.summary.length > 200
      ) {
        throw new BadRequestException(
          'Invalid deterministic partial operation reference',
        );
      }
    }
  }

  private assertLoopDetectedCompletion(
    execution: ExecutionEntity,
    rows: ExecutionEventEntity[],
    error: string | null,
    completion?: ExecutionCompletion,
  ): void {
    if (completion?.reason !== 'partial_loop_guard') return;
    const hasTermination = rows.some((row) => {
      const payload = row.envelope.payload as Record<string, any> | undefined;
      const signal = payload?.loopGuardSignal as
        Record<string, unknown> | undefined;
      return (
        row.executionId === execution.executionId &&
        row.eventType === 'progress.reported' &&
        payload?.kind === 'loop_guard_triggered' &&
        signal?.action === 'terminate'
      );
    });
    if (!hasTermination) {
      throw new BadRequestException(
        'Loop-detected completion requires a durable termination signal',
      );
    }
    if (error && (completion.kind === 'partial' || completion.partialResult)) {
      throw new BadRequestException(
        'Failed loop termination cannot contain a partial result',
      );
    }
    if (!error && completion.source !== 'runtime_template') {
      throw new BadRequestException(
        'Successful loop termination requires a runtime template',
      );
    }
  }
}
