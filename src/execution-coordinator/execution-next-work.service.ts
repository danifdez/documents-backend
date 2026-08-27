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
    let selectedWorkItems = 0;
    for (const selector of this.selectors) {
      if (selectedWorkItems >= limit) break;
      selectedWorkItems += await selector.selectNextWork(
        limit - selectedWorkItems,
      );
    }
    const terminalCandidates =
      await this.terminalCandidates.promoteReady(limit);
    return { selectedWorkItems, terminalCandidates };
  }
}
