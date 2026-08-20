export const EXECUTION_EVENT_SCHEMA = 'execution-event/1';
export const EXECUTION_BUNDLE_SCHEMA = 'execution-bundle/1';
export const EXECUTION_CONTRACT_SET_HASH =
  'sha256:389f8342ad266a65fead0ec8e61e03811f781f4e419bc02f8740bcd4d8e98e1e';

export const EXECUTION_EVENT_PAYLOADS: Record<string, string> = {
  'execution.created': 'execution.created/1',
  'execution.state_changed': 'execution.state_changed/1',
  'operation.started': 'operation.started/1',
  'operation.finished': 'operation.finished/1',
  'message.recorded': 'message.recorded/1',
  'source.observed': 'source.observed/1',
  'progress.reported': 'progress.reported/1',
};
