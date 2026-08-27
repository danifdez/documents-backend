import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from '../execution/execution-control-plane.types';

export const REDUCTION_TREE_FAN_IN = 8;

type WorkflowStep = Omit<CreateExecutionStepInput, 'executionId'>;

interface ReductionNodeInput {
  dependencyStepIds: string[];
  level: number;
  groupIndex: number;
  final: boolean;
}

export function buildReductionTree(
  leafSteps: WorkflowStep[],
  createReductionStep: (input: ReductionNodeInput) => WorkflowStep,
  fanIn = REDUCTION_TREE_FAN_IN,
): WorkflowStep[] {
  if (!leafSteps.length) throw new Error('Reduction tree requires leaves');
  if (!Number.isInteger(fanIn) || fanIn < 2) {
    throw new Error('Reduction tree fan-in must be at least two');
  }

  let frontier = leafSteps.map((step) => {
    if (!step.stepId) throw new Error('Reduction tree leaves require step IDs');
    return step.stepId;
  });
  const reductionSteps: WorkflowStep[] = [];
  let level = 1;

  while (true) {
    const finalLevel = frontier.length <= fanIn;
    const nextFrontier: string[] = [];
    for (let index = 0; index < frontier.length; index += fanIn) {
      const dependencyStepIds = frontier.slice(index, index + fanIn);
      const step = createReductionStep({
        dependencyStepIds,
        level,
        groupIndex: nextFrontier.length,
        final: finalLevel,
      });
      const stepId = step.stepId ?? randomUUID();
      reductionSteps.push({ ...step, stepId });
      nextFrontier.push(stepId);
    }
    if (finalLevel) break;
    frontier = nextFrontier;
    level += 1;
  }

  return [...leafSteps, ...reductionSteps];
}
