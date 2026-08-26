import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
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

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    @InjectRepository(WorkerEntity)
    private readonly repo: Repository<WorkerEntity>,
    @InjectRepository(ExecutionStepAttemptEntity)
    private readonly attempts: Repository<ExecutionStepAttemptEntity>,
  ) {}

  async findAll(): Promise<WorkerEntity[]> {
    return this.repo.find({ order: { lastHeartbeat: 'DESC' } });
  }

  async findOnline(): Promise<WorkerEntity[]> {
    return this.repo.find({
      where: { status: 'online' },
      order: { lastHeartbeat: 'DESC' },
    });
  }

  async findById(id: string): Promise<WorkerEntity | null> {
    return this.repo.findOneBy({ id });
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
    const existing = await this.repo
      .createQueryBuilder('worker')
      .addSelect('worker.credentialHash')
      .where('worker.id = :id', { id })
      .getOne();
    if (existing && existing.workerKind !== workerKind) {
      throw new ConflictException('worker_identity_kind_conflict');
    }
    if (
      existing?.ownerPrincipal &&
      existing.ownerPrincipal !== ownerPrincipal
    ) {
      throw new ForbiddenException('worker_identity_owner_mismatch');
    }
    const credential = randomBytes(32).toString('base64url');
    const worker = existing ?? this.repo.create({ id });
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
    return { worker: await this.repo.save(worker), credential };
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
    const worker = await this.repo
      .createQueryBuilder('worker')
      .addSelect('worker.credentialHash')
      .where('worker.id = :id', { id })
      .getOne();
    if (!worker || worker.workerKind !== WorkerKind.BROWSER) {
      throw new NotFoundException('browser_installation_not_found');
    }
    if (worker.ownerPrincipal !== ownerPrincipal) {
      throw new ForbiddenException('worker_identity_owner_mismatch');
    }
    worker.status = 'revoked';
    worker.revokedAt = new Date();
    worker.credentialHash = null;
    await this.repo.save(worker);
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
    const staleWorkers = await this.repo.find({
      where: {
        status: 'online',
        lastHeartbeat: LessThan(threshold),
      },
    });

    if (staleWorkers.length === 0) return 0;

    for (const worker of staleWorkers) {
      worker.status = 'offline';
      this.logger.warn(
        `Marking worker ${worker.name} (${worker.id}) as offline — ` +
          `last heartbeat: ${worker.lastHeartbeat.toISOString()}`,
      );
    }

    await this.repo.save(staleWorkers);
    return staleWorkers.length;
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
