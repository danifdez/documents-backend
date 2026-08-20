export const EXECUTION_EVENT_SCHEMA = 'execution-event/1';
export const EXECUTION_BUNDLE_SCHEMA = 'execution-bundle/1';
export const EXECUTION_CONTRACT_SET_HASH =
  'sha256:34107e825299d24137d2b5add08c42a6dd5b77b4c18b991e19e7ec32c8888d76';

export const EXECUTION_EVENT_PAYLOADS: Record<string, string> = {
  'execution.created': 'execution.created/1',
  'execution.state_changed': 'execution.state_changed/1',
  'operation.started': 'operation.started/1',
  'operation.finished': 'operation.finished/1',
  'message.recorded': 'message.recorded/1',
  'source.observed': 'source.observed/1',
  'progress.reported': 'progress.reported/1',
};
