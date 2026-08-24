export enum ExecutionOperationKind {
  INFERENCE = 'inference',
  TOOL_CALL = 'tool_call',
  HTTP = 'http',
  CONTEXT_BUILD = 'context_build',
  BROWSER_OBSERVATION = 'browser_observation',
  BROWSER_ACTION = 'browser_action',
  VERIFICATION = 'verification',
  ARTIFACT_PROCESSING = 'artifact_processing',
}
