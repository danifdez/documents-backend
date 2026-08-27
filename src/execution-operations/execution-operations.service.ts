import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ExecutionCoordinatorService } from '../execution-coordinator/execution-coordinator.service';
import { ExecutionAttemptService } from '../execution/execution-attempt.service';
import { ExecutionService } from '../execution/execution.service';
import { WorkerService } from '../worker/worker.service';
import {
  ExecutionOperationalCheck,
  ExecutionOperationalSnapshot,
  ExecutionReconciliationResult,
} from './execution-operations.types';

const FINALIZATION_STALE_AFTER_MS = 5 * 60 * 1_000;

type MetricRow = Record<string, string | number | null>;

@Injectable()
export class ExecutionOperationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly coordinator: ExecutionCoordinatorService,
    private readonly attempts: ExecutionAttemptService,
    private readonly executions: ExecutionService,
    private readonly workers: WorkerService,
  ) {}

  async snapshot(now = new Date()): Promise<ExecutionOperationalSnapshot> {
    const staleBefore = new Date(now.getTime() - FINALIZATION_STALE_AFTER_MS);
    const [
      queue,
      attempts,
      workers,
      publication,
      recovery,
      artifacts,
      registrations,
    ] = await Promise.all([
      this.one(
        `SELECT
             count(*) FILTER (WHERE "status" = 'ready' AND "available_at" <= $1) AS "ready",
             count(*) FILTER (WHERE "status" = 'running') AS "running",
             count(*) FILTER (WHERE "status" = 'blocked') AS "blocked",
             count(*) FILTER (
               WHERE "status" IN ('ready', 'running', 'blocked')
                 AND "deadline" IS NOT NULL AND "deadline" <= $1
             ) AS "overdueDeadlines",
             coalesce(max(
               extract(epoch FROM ($1 - "available_at")) * 1000
             ) FILTER (
               WHERE "status" = 'ready' AND "available_at" <= $1
             ), 0) AS "oldestReadyMs"
           FROM "execution_steps"`,
        [now],
      ),
      this.one(
        `SELECT
             count(*) FILTER (WHERE attempt."status" = 'leased') AS "leased",
             count(*) FILTER (WHERE attempt."status" = 'running') AS "running",
             count(*) FILTER (WHERE attempt."status" = 'result_received') AS "resultReceived",
             count(*) FILTER (
               WHERE attempt."status" IN ('leased', 'running')
                 AND attempt."lease_expires_at" <= $1
             ) AS "expiredActiveLeases",
             coalesce(max(
               extract(epoch FROM ($1 - receipt."received_at")) * 1000
             ) FILTER (WHERE step."status" = 'result_received'), 0) AS "oldestReceivedMs"
           FROM "execution_step_attempts" attempt
           LEFT JOIN "execution_steps" step
             ON step."step_id" = attempt."step_id"
           LEFT JOIN "execution_result_receipts" receipt
             ON receipt."attempt_id" = attempt."attempt_id"`,
        [now],
      ),
      this.one(
        `SELECT
             (SELECT count(*) FROM "workers"
              WHERE "status" = 'online') AS "online",
             (SELECT count(*) FROM "workers"
              WHERE "status" = 'offline') AS "offline",
             (SELECT count(*) FROM "workers"
              WHERE "revoked_at" IS NOT NULL) AS "revoked",
             (SELECT coalesce(sum("maximum_concurrency"), 0) FROM "workers"
              WHERE "status" = 'online') AS "maximumConcurrency",
             (SELECT count(*) FROM "execution_step_attempts"
              WHERE "status" IN ('leased', 'running')
                AND "lease_expires_at" > $1) AS "activeAssignments"`,
        [now],
      ),
      this.one(
        `SELECT
             count(*) FILTER (WHERE "status" = 'pending') AS "pending",
             count(*) FILTER (WHERE "status" = 'publishing') AS "publishing",
             count(*) FILTER (
               WHERE "status" = 'publishing' AND "lease_expires_at" <= $1
             ) AS "expiredPublishingLeases",
             coalesce(max(
               extract(epoch FROM ($1 - "created_at")) * 1000
             ) FILTER (WHERE "status" != 'published'), 0) AS "oldestUnpublishedMs"
           FROM "execution_outbox"`,
        [now],
      ),
      this.one(
        `SELECT
             (SELECT count(*) FROM "executions"
              WHERE "phase" IN ('domain_finalization', 'domain_failure_finalization')
                AND "updated_at" <= $1) AS "staleFinalizations",
             (SELECT count(*) FROM "execution_effect_journal"
              WHERE "status" = 'prepared' AND "updated_at" <= $1) AS "staleEffects",
             (SELECT count(*) FROM "execution_effect_journal"
              WHERE "status" = 'inconclusive') AS "inconclusiveEffects",
             (SELECT count(*) FROM "execution_confirmations"
              WHERE "status" = 'pending' AND "expires_at" <= $2) AS "expiredConfirmations"`,
        [staleBefore, now],
      ),
      this.one(
        `SELECT
             count(*) FILTER (WHERE "content_state" = 'active') AS "active",
             count(*) FILTER (WHERE "content_state" != 'active') AS "unavailable",
             count(*) FILTER (
               WHERE "content_state" = 'active' AND "expires_at" <= $1
             ) AS "expiredButActive",
             coalesce(sum("size"::numeric) FILTER (
               WHERE "content_state" = 'active'
             ), 0) AS "activeBytes",
             coalesce(max("size"::numeric) FILTER (
               WHERE "content_state" = 'active'
             ), 0) AS "largestActiveBytes"
           FROM "execution_artifacts"`,
        [now],
      ),
      this.workers.registrations(),
    ]);

    const queueMetrics = {
      ready: this.number(queue.ready),
      running: this.number(queue.running),
      blocked: this.number(queue.blocked),
      overdueDeadlines: this.number(queue.overdueDeadlines),
      oldestReadyMs: this.number(queue.oldestReadyMs),
    };
    const attemptMetrics = {
      leased: this.number(attempts.leased),
      running: this.number(attempts.running),
      resultReceived: this.number(attempts.resultReceived),
      expiredActiveLeases: this.number(attempts.expiredActiveLeases),
      oldestReceivedMs: this.number(attempts.oldestReceivedMs),
    };
    const maximumConcurrency = this.number(workers.maximumConcurrency);
    const activeAssignments = this.number(workers.activeAssignments);
    const workerMetrics = {
      online: this.number(workers.online),
      offline: this.number(workers.offline),
      revoked: this.number(workers.revoked),
      maximumConcurrency,
      activeAssignments,
      availableConcurrency: Math.max(maximumConcurrency - activeAssignments, 0),
    };
    const publicationMetrics = {
      pending: this.number(publication.pending),
      publishing: this.number(publication.publishing),
      expiredPublishingLeases: this.number(publication.expiredPublishingLeases),
      oldestUnpublishedMs: this.number(publication.oldestUnpublishedMs),
    };
    const recoveryMetrics = {
      staleFinalizations: this.number(recovery.staleFinalizations),
      staleEffects: this.number(recovery.staleEffects),
      inconclusiveEffects: this.number(recovery.inconclusiveEffects),
      expiredConfirmations: this.number(recovery.expiredConfirmations),
    };
    const artifactMetrics = {
      active: this.number(artifacts.active),
      unavailable: this.number(artifacts.unavailable),
      expiredButActive: this.number(artifacts.expiredButActive),
      activeBytes: this.number(artifacts.activeBytes),
      largestActiveBytes: this.number(artifacts.largestActiveBytes),
    };
    const slo = {
      readyQueue: this.check(
        queueMetrics.oldestReadyMs,
        'EXECUTION_SLO_READY_MS',
        60_000,
      ),
      resultCoordination: this.check(
        attemptMetrics.oldestReceivedMs,
        'EXECUTION_SLO_RESULT_COORDINATION_MS',
        30_000,
      ),
      publication: this.check(
        publicationMetrics.oldestUnpublishedMs,
        'EXECUTION_SLO_PUBLICATION_MS',
        30_000,
      ),
    };
    const degraded =
      Object.values(slo).some((check) => check.status === 'degraded') ||
      queueMetrics.overdueDeadlines > 0 ||
      attemptMetrics.expiredActiveLeases > 0 ||
      publicationMetrics.expiredPublishingLeases > 0 ||
      recoveryMetrics.staleFinalizations > 0 ||
      recoveryMetrics.staleEffects > 0 ||
      recoveryMetrics.inconclusiveEffects > 0 ||
      recoveryMetrics.expiredConfirmations > 0 ||
      artifactMetrics.expiredButActive > 0;

    return {
      schemaVersion: 'execution-operations/1',
      generatedAt: now.toISOString(),
      state: degraded ? 'degraded' : 'operational',
      queue: queueMetrics,
      attempts: attemptMetrics,
      workers: workerMetrics,
      registrations,
      publication: publicationMetrics,
      recovery: recoveryMetrics,
      artifacts: artifactMetrics,
      slo,
    };
  }

  async reconcile(limit: number): Promise<ExecutionReconciliationResult> {
    const recoveredEffects =
      await this.coordinator.recoverStaleToolEffects(limit);
    const expiredAttempts = await this.attempts.expireStaleAttempts(
      new Date(),
      limit,
    );
    const expiredConfirmations =
      await this.coordinator.expireConfirmations(limit);
    const recoveredFinalizations =
      await this.coordinator.recoverStaleFinalizations(
        FINALIZATION_STALE_AFTER_MS,
      );
    const acceptedResults = await this.coordinator.acceptResults(limit);
    const finalizedExecutions = await this.coordinator.finalizeReady(limit);
    const publishedNotifications =
      await this.coordinator.publishNotifications(limit);
    const offlinedWorkers = await this.workers.markStaleOffline(60);
    const expiredArtifacts = await this.executions.purgeExpiredArtifacts(limit);
    return {
      schemaVersion: 'execution-reconciliation/1',
      reconciledAt: new Date().toISOString(),
      limit,
      recoveredEffects,
      expiredAttempts,
      expiredConfirmations,
      recoveredFinalizations,
      acceptedResults,
      finalizedExecutions,
      publishedNotifications,
      offlinedWorkers,
      expiredArtifacts,
      stateAfter: await this.snapshot(),
    };
  }

  private async one(sql: string, parameters: unknown[]): Promise<MetricRow> {
    const rows = (await this.dataSource.query(sql, parameters)) as MetricRow[];
    return rows[0] ?? {};
  }

  private check(
    observedMs: number,
    configKey: string,
    fallbackMs: number,
  ): ExecutionOperationalCheck {
    const thresholdMs = this.positiveInteger(
      this.config.get<string>(configKey),
      fallbackMs,
    );
    return {
      observedMs,
      thresholdMs,
      status: observedMs <= thresholdMs ? 'ok' : 'degraded',
    };
  }

  private number(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : 0;
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
