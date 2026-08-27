import { ExecutionUnresolvedInferenceSelectorService } from '../../../src/execution-coordinator/execution-unresolved-inference-selector.service';
import { ExecutionStatus } from '../../../src/execution/execution-status.enum';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionStepStatus } from '../../../src/execution/execution-step-status.enum';
import { ExecutionStepEntity } from '../../../src/execution/execution-step.entity';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('ExecutionUnresolvedInferenceSelectorService', () => {
  it.each([
    [
      { kind: 'invalid', reason: 'schema_mismatch' },
      'invalid_inference_outcome',
    ],
    [
      { kind: 'tool_requests', calls: [] },
      'unsupported_inference_continuation',
    ],
  ])(
    'fails an unhandled non-agent outcome as typed terminal work',
    async (outcome, code) => {
      const step = {
        stepId: 'step-1',
        executionId: 'execution-1',
        stepKind: ExecutionStepKind.INFERENCE,
        status: ExecutionStepStatus.COMPLETED,
        continuationProcessedAt: null,
        result: { kind: ExecutionStepKind.INFERENCE, outcome },
      };
      const execution = {
        executionId: 'execution-1',
        taskType: 'summarize-reduce',
        status: ExecutionStatus.RUNNING,
        phase: 'coordination_pending',
        cancellationRequestedAt: null,
        result: outcome,
        error: null,
      };
      const stepRepo = {
        findOne: jest.fn().mockResolvedValue(step),
        save: jest.fn(async (value) => value),
      };
      const executionRepo = {
        findOne: jest.fn().mockResolvedValue(execution),
        save: jest.fn(async (value) => value),
      };
      const manager = {
        getRepository: jest.fn((entity) => {
          if (entity === ExecutionStepEntity) return stepRepo;
          if (entity === ExecutionEntity) return executionRepo;
          throw new Error(`Unexpected repository ${entity.name}`);
        }),
      };
      const dataSource = {
        query: jest.fn().mockResolvedValue([{ step_id: step.stepId }]),
        transaction: jest.fn(async (callback) => callback(manager)),
      };
      const selector = new ExecutionUnresolvedInferenceSelectorService(
        dataSource as any,
      );

      await expect(selector.selectNextWork()).resolves.toBe(1);
      expect(step.continuationProcessedAt).toEqual(expect.any(Date));
      expect(execution).toMatchObject({
        result: null,
        phase: 'terminal_pending_failed',
        error: { code },
      });
    },
  );
});
