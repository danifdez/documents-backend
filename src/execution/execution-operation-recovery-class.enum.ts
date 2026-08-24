export enum ExecutionOperationRecoveryClass {
  READ_ONLY_REPLAYABLE = 'read_only_replayable',
  IDEMPOTENT = 'idempotent',
  EFFECT_CHECKED = 'effect_checked',
  NON_RESUMABLE = 'non_resumable',
}
