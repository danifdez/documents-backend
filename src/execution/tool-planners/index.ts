import { BROWSER_TOOL_PLAN_PREPARERS } from './browser-tool-planners';
import { INTERNAL_TOOL_PLAN_PREPARERS } from './internal-tool-planners';
import { ToolPlanPreparer } from './tool-plan-preparer';
import { WORKSPACE_FILE_TOOL_PLAN_PREPARERS } from './workspace-file-tool-planners';

const TOOL_PLAN_PREPARERS = new Map<string, ToolPlanPreparer>([
  ...INTERNAL_TOOL_PLAN_PREPARERS,
  ...BROWSER_TOOL_PLAN_PREPARERS,
  ...WORKSPACE_FILE_TOOL_PLAN_PREPARERS,
]);

export function getToolPlanPreparer(
  toolName: string,
): ToolPlanPreparer | undefined {
  return TOOL_PLAN_PREPARERS.get(toolName);
}
