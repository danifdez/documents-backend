import { Inject, Injectable } from '@nestjs/common';
import {
  EXECUTION_NEXT_STEP_SELECTORS,
  ExecutionNextStepSelector,
  ExecutionNextWorkResult,
} from './execution-next-work.types';
import { ExecutionTerminalCandidateService } from './execution-terminal-candidate.service';

@Injectable()
export class ExecutionNextWorkService {
  constructor(
    @Inject(EXECUTION_NEXT_STEP_SELECTORS)
    private readonly selectors: ExecutionNextStepSelector[],
    private readonly terminalCandidates: ExecutionTerminalCandidateService,
  ) {}

  async select(limit = 20): Promise<ExecutionNextWorkResult> {
    const selectedWorkItems = await this.selectors.reduce(
      async (pending, selector) => {
        const selected = await pending;
        if (selected >= limit) return selected;
        return selected + (await selector.selectNextWork(limit - selected));
      },
      Promise.resolve(0),
    );
    const terminalCandidates =
      await this.terminalCandidates.promoteReady(limit);
    return { selectedWorkItems, terminalCandidates };
  }
}
