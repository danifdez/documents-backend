import { BadRequestException } from '@nestjs/common';
import { ExecutionArtifactEntity } from '../../../src/execution/execution-artifact.entity';
import { contentHash } from '../../../src/execution/execution-canonical';
import { ExecutionCompletionValidator } from '../../../src/execution/execution-completion-validator';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ExecutionEventEntity } from '../../../src/execution/execution-event.entity';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

describe('ExecutionCompletionValidator', () => {
  const validator = new ExecutionCompletionValidator();
  const execution = {
    executionId: EXECUTION_ID,
    rootExecutionId: EXECUTION_ID,
  } as ExecutionEntity;

  it('accepts only durable leaf-tool evidence for a runtime partial', () => {
    const reply = 'Completed work: Document read';
    const artifactId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca714';
    const operationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca710';
    const toolCallId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca711';
    const grantId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca712';
    const events = [
      {
        sequence: '1',
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'operation.started',
        envelope: {
          toolCallId,
          payload: {
            operationKind: 'tool_call',
            name: 'folder_read',
            loopKind: 'top_level',
            loopId: EXECUTION_ID,
            budgetGrantId: grantId,
          },
        },
      },
      {
        sequence: '2',
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'operation.finished',
        envelope: {
          payload: {
            operationKind: 'tool_call',
            status: 'succeeded',
            result: { value: 'fixture' },
            resultSummary: 'Document read',
            resultSummaryKind: 'leaf_tool',
          },
        },
      },
      {
        sequence: '3',
        executionId: EXECUTION_ID,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca713',
        eventType: 'operation.started',
        envelope: {
          payload: {
            operationKind: 'inference',
            phase: 'forced_finalization',
            loopId: EXECUTION_ID,
            budgetGrantId: grantId,
          },
        },
      },
      {
        sequence: '4',
        executionId: EXECUTION_ID,
        operationId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca713',
        eventType: 'operation.finished',
        envelope: {
          payload: {
            operationKind: 'inference',
            status: 'succeeded',
            outcome: 'invalid',
            reason: 'empty_model_response',
            result: {},
          },
        },
      },
      {
        sequence: '5',
        executionId: EXECUTION_ID,
        operationId: null,
        eventType: 'message.recorded',
        envelope: {
          actor: { type: 'system' },
          payload: {
            messageKind: 'final_response',
            generationSource: 'runtime_template',
            contentPreview: reply,
            contentArtifactId: artifactId,
          },
          artifactRefs: [artifactId],
        },
      },
    ] as unknown as ExecutionEventEntity[];
    const artifacts = [
      {
        artifactId,
        rootExecutionId: EXECUTION_ID,
        kind: 'model_response',
        mediaType: 'text/plain',
        body: Buffer.from(reply),
        contentHash: contentHash(reply),
        size: String(Buffer.byteLength(reply)),
      },
    ] as ExecutionArtifactEntity[];
    const completion = {
      kind: 'partial' as const,
      reason: 'partial_budget_exhausted',
      source: 'runtime_template' as const,
      partialResult: {
        version: '1' as const,
        trigger: 'closing_output_empty' as const,
        loopId: EXECUTION_ID,
        grantId,
        completedOperations: [
          {
            operationId,
            toolCallId,
            name: 'folder_read',
            summary: 'Document read',
          },
        ],
        pending: ['final_synthesis'] as ['final_synthesis'],
      },
    };
    const validate = () =>
      validator.validate({
        execution,
        events,
        artifacts,
        safeReply: reply,
        error: null,
        completion,
      });

    expect(validate).not.toThrow();
    events[3].envelope.payload['reason'] = 'transport_error';
    expect(validate).toThrow(BadRequestException);
    events[3].envelope.payload['reason'] = 'empty_model_response';
    completion.partialResult.completedOperations[0].summary = 'Invented';
    expect(validate).toThrow(BadRequestException);
    completion.partialResult.completedOperations[0].summary = 'Document read';
    expect(() =>
      validator.validate({
        execution,
        events,
        artifacts,
        safeReply: 'Different reply',
        error: null,
        completion,
      }),
    ).toThrow(BadRequestException);
  });

  it('requires durable termination evidence for a loop-detected failure', () => {
    const completion = { reason: 'partial_loop_guard' };
    const termination = {
      executionId: EXECUTION_ID,
      eventType: 'progress.reported',
      envelope: {
        payload: {
          kind: 'loop_guard_triggered',
          loopGuardSignal: { action: 'terminate' },
        },
      },
    } as unknown as ExecutionEventEntity;
    const validate = (events: ExecutionEventEntity[], error: string | null) =>
      validator.validate({
        execution,
        events,
        artifacts: [],
        safeReply: '',
        error,
        completion,
      });

    expect(() =>
      validate([termination], 'Immediate exact tool repeat persisted'),
    ).not.toThrow();
    expect(() => validate([], 'Immediate exact tool repeat persisted')).toThrow(
      BadRequestException,
    );
    expect(() => validate([termination], null)).toThrow(BadRequestException);
  });

  it('accepts only the strategy-change shape for loop partials', () => {
    const reply = 'Completed work: Document read';
    const artifactId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca714';
    const operationId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca705';
    const toolCallId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca706';
    const grantId = '018f1d8a-54d7-7d63-a1ee-5e9a6adca704';
    const events = [
      {
        sequence: '1',
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'operation.started',
        envelope: {
          toolCallId,
          payload: {
            operationKind: 'tool_call',
            name: 'folder_read',
            loopKind: 'top_level',
            loopId: EXECUTION_ID,
            budgetGrantId: grantId,
          },
        },
      },
      {
        sequence: '2',
        executionId: EXECUTION_ID,
        operationId,
        eventType: 'operation.finished',
        envelope: {
          payload: {
            operationKind: 'tool_call',
            status: 'succeeded',
            resultSummary: 'Document read',
            resultSummaryKind: 'leaf_tool',
          },
        },
      },
      {
        sequence: '3',
        executionId: EXECUTION_ID,
        operationId: null,
        eventType: 'progress.reported',
        envelope: {
          payload: {
            kind: 'loop_guard_triggered',
            loopGuardSignal: {
              action: 'terminate',
              grantId,
              loopId: EXECUTION_ID,
            },
          },
        },
      },
      {
        sequence: '4',
        executionId: EXECUTION_ID,
        operationId: null,
        eventType: 'message.recorded',
        envelope: {
          actor: { type: 'system' },
          payload: {
            messageKind: 'final_response',
            generationSource: 'runtime_template',
            contentPreview: reply,
            contentArtifactId: artifactId,
          },
          artifactRefs: [artifactId],
        },
      },
    ] as unknown as ExecutionEventEntity[];
    const artifacts = [
      {
        artifactId,
        rootExecutionId: EXECUTION_ID,
        kind: 'model_response',
        mediaType: 'text/plain',
        body: Buffer.from(reply),
        contentHash: contentHash(reply),
        size: String(Buffer.byteLength(reply)),
      },
    ] as ExecutionArtifactEntity[];
    const partialResult = {
      version: '1' as const,
      trigger: 'exact_tool_repeat_persisted' as const,
      loopId: EXECUTION_ID,
      grantId,
      completedOperations: [
        {
          operationId,
          toolCallId,
          name: 'folder_read',
          summary: 'Document read',
        },
      ],
      pending: ['strategy_change'] as ['strategy_change'],
      continuation: {
        kind: 'new_turn' as const,
        reason: 'different_strategy_required' as const,
      },
    };
    const validate = () =>
      validator.validate({
        execution,
        events,
        artifacts,
        safeReply: reply,
        error: null,
        completion: {
          kind: 'partial',
          reason: 'partial_loop_guard',
          source: 'runtime_template',
          partialResult,
        },
      });

    expect(validate).not.toThrow();
    partialResult.pending = ['final_synthesis'] as never;
    expect(validate).toThrow(BadRequestException);
  });
});
