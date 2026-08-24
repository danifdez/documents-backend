export enum ExecutionStepAttemptStatus {
  LEASED = 'leased',
  RUNNING = 'running',
  RESULT_RECEIVED = 'result_received',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
  CLOSED = 'closed',
}
