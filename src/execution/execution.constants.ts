export const EXECUTION_SCHEMA = 'execution/1';
export const EXECUTION_EVENT_SCHEMA = 'execution-event/1';
export const EXECUTION_BUNDLE_SCHEMA = 'execution-bundle/1';
export const EXECUTION_CONTRACT_SET_HASH =
  'sha256:3f241f5f73a6d6a319d981d936bff3d556e4394d126d3d8f81f4f48d5007c8bd';
export const EXECUTION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXECUTION_CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const EXECUTION_EVENT_PAYLOADS: Record<string, string> = {
  'execution.created': 'execution.created/1',
  'execution.state_changed': 'execution.state_changed/1',
  'operation.started': 'operation.started/1',
  'operation.finished': 'operation.finished/1',
  'message.recorded': 'message.recorded/1',
  'source.observed': 'source.observed/1',
  'progress.reported': 'progress.reported/1',
  'confirmation.requested': 'confirmation.requested/1',
  'confirmation.decided': 'confirmation.decided/1',
};
