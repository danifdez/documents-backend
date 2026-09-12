import { randomUUID } from 'crypto';
import { CreateExecutionStepInput } from './execution-control-plane.types';
import { ExecutionStepKind } from './execution-step-kind.enum';

export const REDUCTION_TREE_FAN_IN = 8;

type WorkflowStep = Omit<CreateExecutionStepInput, 'executionId'>;
type WorkflowStage = Omit<
  WorkflowStep,
  'stepId' | 'stepKind' | 'dependsOnStepIds'
> & { stepKind?: ExecutionStepKind };

interface ReductionNodeInput {
  dependencyStepIds: string[];
  level: number;
  groupIndex: number;
  final: boolean;
}

interface MapWorkflowInput<T> {
  items: readonly T[];
  emptyInputError: string;
  map: (item: T, index: number) => WorkflowStage;
}

interface MapReduceWorkflowInput<T> extends MapWorkflowInput<T> {
  fanIn?: number;
  reduce: (
    input: Omit<ReductionNodeInput, 'dependencyStepIds'>,
  ) => WorkflowStage & { resultKey: string };
}

interface MapComposeWorkflowInput<T> extends MapWorkflowInput<T> {
  resultKey: string;
  compose: () => WorkflowStage;
}

function createStep(stage: WorkflowStage): WorkflowStep & { stepId: string } {
  const { stepKind = ExecutionStepKind.INFERENCE, ...rest } = stage;
  return { stepId: randomUUID(), stepKind, ...rest };
}

export function buildMapSteps<T>({
  items,
  emptyInputError,
  map,
}: MapWorkflowInput<T>): Array<WorkflowStep & { stepId: string }> {
  if (!items.length) throw new Error(emptyInputError);
  return items.map((item, index) => createStep(map(item, index)));
}

export function buildMapReduceWorkflow<T>({
  items,
  emptyInputError,
  map,
  reduce,
  fanIn = REDUCTION_TREE_FAN_IN,
}: MapReduceWorkflowInput<T>): WorkflowStep[] {
  const mapSteps = buildMapSteps({ items, emptyInputError, map });
  return buildReductionTree(
    mapSteps,
    ({ dependencyStepIds, level, groupIndex, final }) => {
      const {
        resultKey,
        stepKind = ExecutionStepKind.INFERENCE,
        ...stage
      } = reduce({ level, groupIndex, final });
      return {
        stepKind,
        dependsOnStepIds: dependencyStepIds,
        ...stage,
        work: {
          ...stage.work,
          coordination: {
            kind: 'map-reduce-reduce/1',
            mapStepIds: dependencyStepIds,
            resultKey,
          },
        },
      };
    },
    fanIn,
  );
}

export function buildMapComposeWorkflow<T>({
  items,
  emptyInputError,
  resultKey,
  map,
  compose,
}: MapComposeWorkflowInput<T>): WorkflowStep[] {
  const mapSteps = buildMapSteps({ items, emptyInputError, map });
  const mapStepIds = mapSteps.map((step) => step.stepId);
  const { stepKind = ExecutionStepKind.INFERENCE, ...composition } = compose();

  return [
    ...mapSteps,
    {
      stepId: randomUUID(),
      stepKind,
      dependsOnStepIds: mapStepIds,
      ...composition,
      work: {
        ...composition.work,
        coordination: {
          kind: 'map-reduce-reduce/1',
          mapStepIds,
          resultKey,
        },
      },
    },
  ];
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
