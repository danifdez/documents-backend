import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ExecutionStepAttemptEntity } from '../execution/execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from '../execution/execution-step-attempt-status.enum';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { WorkerEntity } from './worker.entity';
import { WorkerRegistrationView } from './worker-registration.types';
import { WorkerKind } from './worker-kind.enum';
import {
  BROWSER_CLICK_TOOL_CAPABILITY,
  BROWSER_GO_BACK_TOOL_CAPABILITY,
  BROWSER_NAVIGATE_TOOL_CAPABILITY,
  BROWSER_READ_TOOL_CAPABILITY,
  BROWSER_SELECT_OPTION_TOOL_CAPABILITY,
  BROWSER_TYPE_TEXT_TOOL_CAPABILITY,
} from '../execution/execution-tool.constants';
import { WorkerCredentialEventEntity } from './worker-credential-event.entity';

@Injectable()
export class WorkerService {
  constructor(
    @InjectRepository(WorkerEntity)
    private readonly repo: Repository<WorkerEntity>,
    @InjectRepository(ExecutionStepAttemptEntity)
    private readonly attempts: Repository<ExecutionStepAttemptEntity>,
    @InjectRepository(WorkerCredentialEventEntity)
    private readonly credentialEvents: Repository<WorkerCredentialEventEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async credentialHistory(id: string): Promise<WorkerCredentialEventEntity[]> {
    return this.credentialEvents.find({
      where: { workerId: id },
      order: { occurredAt: 'DESC' },
      take: 100,
    });
  }

  async registerModels(
    id: string,
    name: string,
    capabilities: string[],
    stepKinds: ExecutionStepKind[],
    maximumConcurrency: number,
    metadata: Record<string, unknown>,
  ): Promise<{ worker: WorkerEntity; credential: string }> {
    this.assertModelsStepKinds(stepKinds);
    return this.register(
      id,
      name,
      WorkerKind.MODELS,
      null,
      capabilities,
      stepKinds,
      maximumConcurrency,
      metadata,
    );
  }

  async enrollBrowser(
    id: string,
    name: string,
    ownerPrincipal: string,
    metadata: Record<string, unknown>,
  ): Promise<{ worker: WorkerEntity; credential: string }> {
    return this.register(
      id,
      name,
      WorkerKind.BROWSER,
      ownerPrincipal,
      [
        BROWSER_READ_TOOL_CAPABILITY,
        BROWSER_NAVIGATE_TOOL_CAPABILITY,
        BROWSER_GO_BACK_TOOL_CAPABILITY,
        BROWSER_CLICK_TOOL_CAPABILITY,
        BROWSER_TYPE_TEXT_TOOL_CAPABILITY,
        BROWSER_SELECT_OPTION_TOOL_CAPABILITY,
      ],
      [ExecutionStepKind.TOOL],
      1,
      metadata,
    );
  }

  private async register(
    id: string,
    name: string,
    workerKind: WorkerKind,
    ownerPrincipal: string | null,
    capabilities: string[],
    stepKinds: ExecutionStepKind[],
    maximumConcurrency: number,
    metadata: Record<string, unknown>,
  ): Promise<{ worker: WorkerEntity; credential: string }> {
    this.assertMaximumConcurrency(maximumConcurrency);
    const credential = randomBytes(32).toString('base64url');
    const worker = await this.dataSource.transaction(async (manager) => {
      const workerRepo = manager.getRepository(WorkerEntity);
      const eventRepo = manager.getRepository(WorkerCredentialEventEntity);
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [id],
      );
      const existing = await workerRepo
        .createQueryBuilder('worker')
        .addSelect('worker.credentialHash')
        .where('worker.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();
      if (existing && existing.workerKind !== workerKind) {
        throw new ConflictException('worker_identity_kind_conflict');
      }
      if (existing?.revokedAt) {
        throw new ConflictException('worker_identity_revoked');
      }
      if (
        existing?.ownerPrincipal &&
        existing.ownerPrincipal !== ownerPrincipal
      ) {
        throw new ForbiddenException('worker_identity_owner_mismatch');
      }
      const worker = existing ?? workerRepo.create({ id });
      worker.name = name;
      worker.workerKind = workerKind;
      worker.ownerPrincipal = ownerPrincipal;
      worker.capabilities = [...new Set(capabilities)];
      worker.protocolVersion = 'step-protocol/1';
      worker.stepKinds = [...new Set(stepKinds)];
      worker.maximumConcurrency = maximumConcurrency;
      worker.status = 'online';
      worker.lastHeartbeat = new Date();
      worker.startedAt = new Date();
      worker.metadata = metadata;
      worker.credentialHash = this.hashCredential(credential);
      worker.revokedAt = null;
      const saved = await workerRepo.save(worker);
      await eventRepo.save(
        eventRepo.create({
          workerId: saved.id,
          workerKind,
          action: existing ? 'rotated' : 'issued',
          actorType: workerKind === WorkerKind.MODELS ? 'service' : 'user',
          actorPrincipal: ownerPrincipal,
          metadata: { protocolVersion: saved.protocolVersion },
        }),
      );
      return saved;
    });
    return { worker, credential };
  }

  async authenticate(
    id: string,
    credential: string | undefined,
    expectedKind: WorkerKind,
  ): Promise<WorkerEntity> {
    if (!credential)
      throw new UnauthorizedException('invalid_worker_credential');
    const worker = await this.repo
      .createQueryBuilder('worker')
      .addSelect('worker.credentialHash')
      .where('worker.id = :id', { id })
      .getOne();
    if (
      !worker?.credentialHash ||
      worker.revokedAt ||
      worker.workerKind !== expectedKind
    ) {
      throw new UnauthorizedException('invalid_worker_credential');
    }
    const actual = Buffer.from(this.hashCredential(credential));
    const expected = Buffer.from(worker.credentialHash);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('invalid_worker_credential');
    }
    return worker;
  }

  async revokeBrowser(id: string, ownerPrincipal: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const workerRepo = manager.getRepository(WorkerEntity);
      const eventRepo = manager.getRepository(WorkerCredentialEventEntity);
      const result = await workerRepo.update(
        { id, workerKind: WorkerKind.BROWSER, ownerPrincipal },
        {
          status: 'revoked',
          revokedAt: new Date(),
          credentialHash: null,
        },
      );
      if (!result.affected) {
        throw new NotFoundException('browser_installation_not_found');
      }
      await eventRepo.save(
        eventRepo.create({
          workerId: id,
          workerKind: WorkerKind.BROWSER,
          action: 'revoked',
          actorType: 'user',
          actorPrincipal: ownerPrincipal,
          metadata: {},
        }),
      );
    });
  }

  async revokeCredential(id: string, actorPrincipal: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const workerRepo = manager.getRepository(WorkerEntity);
      const eventRepo = manager.getRepository(WorkerCredentialEventEntity);
      const worker = await workerRepo.findOne({
        where: { id, revokedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!worker) {
        throw new NotFoundException('worker_not_found');
      }
      worker.status = 'revoked';
      worker.revokedAt = new Date();
      worker.credentialHash = null;
      await workerRepo.save(worker);
      await eventRepo.save(
        eventRepo.create({
          workerId: worker.id,
          workerKind: worker.workerKind,
          action: 'revoked',
          actorType: 'user',
          actorPrincipal,
          metadata: {},
        }),
      );
    });
  }

  async heartbeatModels(
    id: string,
    capabilities: string[],
    stepKinds: ExecutionStepKind[],
    maximumConcurrency: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.assertMaximumConcurrency(maximumConcurrency);
    this.assertModelsStepKinds(stepKinds);
    const result = await this.repo.update(
      { id, workerKind: WorkerKind.MODELS, revokedAt: IsNull() },
      {
        capabilities: [...new Set(capabilities)],
        stepKinds: [...new Set(stepKinds)],
        maximumConcurrency,
        metadata: metadata as any,
        status: 'online',
        lastHeartbeat: new Date(),
      },
    );
    if (!result.affected) {
      throw new ConflictException('worker_not_available');
    }
  }

  async heartbeatBrowser(
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.repo.update(
      { id, workerKind: WorkerKind.BROWSER, revokedAt: IsNull() },
      {
        capabilities: [
          BROWSER_READ_TOOL_CAPABILITY,
          BROWSER_NAVIGATE_TOOL_CAPABILITY,
          BROWSER_GO_BACK_TOOL_CAPABILITY,
          BROWSER_CLICK_TOOL_CAPABILITY,
          BROWSER_TYPE_TEXT_TOOL_CAPABILITY,
          BROWSER_SELECT_OPTION_TOOL_CAPABILITY,
        ],
        stepKinds: [ExecutionStepKind.TOOL],
        maximumConcurrency: 1,
        metadata: metadata as any,
        status: 'online',
        lastHeartbeat: new Date(),
      },
    );
    if (!result.affected) {
      throw new ConflictException('worker_not_available');
    }
  }

  async registrations(): Promise<WorkerRegistrationView[]> {
    const workers = await this.repo.find({
      order: { lastHeartbeat: 'DESC' },
      take: 100,
    });
    if (!workers.length) return [];
    const activeAttempts = await this.attempts.find({
      select: {
        attemptId: true,
        claimedBy: true,
        createdAt: true,
      },
      where: {
        claimedBy: In(workers.map((worker) => worker.id)),
        status: In([
          ExecutionStepAttemptStatus.LEASED,
          ExecutionStepAttemptStatus.RUNNING,
        ]),
        leaseExpiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'ASC' },
    });
    const assignments = new Map<string, string[]>();
    for (const attempt of activeAttempts) {
      const current = assignments.get(attempt.claimedBy) ?? [];
      current.push(attempt.attemptId);
      assignments.set(attempt.claimedBy, current);
    }
    return workers.map((worker) =>
      this.registrationView(worker, assignments.get(worker.id) ?? []),
    );
  }

  async markStaleOffline(thresholdSeconds: number = 60): Promise<number> {
    const threshold = new Date(Date.now() - thresholdSeconds * 1000);
    const result = await this.repo.update(
      {
        status: 'online',
        revokedAt: IsNull(),
        lastHeartbeat: LessThan(threshold),
      },
      { status: 'offline' },
    );
    return result.affected ?? 0;
  }

  private hashCredential(credential: string): string {
    return `sha256:${createHash('sha256').update(credential).digest('hex')}`;
  }

  private registrationView(
    worker: WorkerEntity,
    activeAssignments: string[],
  ): WorkerRegistrationView {
    const metadata =
      worker.metadata && typeof worker.metadata === 'object'
        ? (worker.metadata as Record<string, unknown>)
        : {};
    const runtimeVersions: Record<string, string> = {};
    if (typeof metadata.codeFingerprint === 'string') {
      runtimeVersions['documents-models'] = metadata.codeFingerprint;
    }
    if (typeof metadata.runtimeFingerprint === 'string') {
      runtimeVersions['runtime'] = metadata.runtimeFingerprint;
    }
    const installedArtifacts = Array.isArray(metadata.installedArtifacts)
      ? metadata.installedArtifacts.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const hardware = Object.fromEntries(
      ['cpuCount', 'ramGb', 'hasCuda', 'gpuName', 'vramGb']
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, metadata[key]]),
    );
    const available =
      worker.status === 'online'
        ? Math.max(worker.maximumConcurrency - activeAssignments.length, 0)
        : 0;
    return {
      schemaVersion: 'worker-registration/1',
      workerId: worker.id,
      protocolVersion: worker.protocolVersion,
      runtimeVersions,
      installedArtifacts,
      effectiveStepCapabilities: worker.stepKinds.length
        ? [
            {
              schemaVersion: 'worker-capability/1',
              capabilityId: `${worker.id}:effective`,
              stepKinds: worker.stepKinds,
              taskTypes: worker.capabilities,
              maxConcurrency: worker.maximumConcurrency,
            },
          ]
        : [],
      hardware,
      concurrency: {
        maximum: worker.maximumConcurrency,
        available,
      },
      activeAssignments,
      heartbeat: worker.lastHeartbeat.toISOString(),
      loadSummary: {
        state:
          worker.status !== 'online'
            ? 'offline'
            : available > 0
              ? 'available'
              : 'busy',
        active: activeAssignments.length,
      },
    };
  }

  private assertMaximumConcurrency(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 64) {
      throw new BadRequestException('invalid_worker_concurrency');
    }
  }

  private assertModelsStepKinds(stepKinds: ExecutionStepKind[]): void {
    if (stepKinds.includes(ExecutionStepKind.TOOL)) {
      throw new BadRequestException('models_tool_steps_not_allowed');
    }
  }
}
