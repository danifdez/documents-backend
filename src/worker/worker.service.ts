import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { WorkerEntity } from './worker.entity';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    @InjectRepository(WorkerEntity)
    private readonly repo: Repository<WorkerEntity>,
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

  async register(
    id: string,
    name: string,
    capabilities: string[],
    metadata: Record<string, unknown>,
  ): Promise<{ worker: WorkerEntity; credential: string }> {
    const existing = await this.repo
      .createQueryBuilder('worker')
      .addSelect('worker.credentialHash')
      .where('worker.id = :id', { id })
      .getOne();
    const credential = randomBytes(32).toString('base64url');
    const worker = existing ?? this.repo.create({ id });
    worker.name = name;
    worker.capabilities = [...new Set(capabilities)];
    worker.status = 'online';
    worker.lastHeartbeat = new Date();
    worker.startedAt = new Date();
    worker.metadata = metadata;
    worker.credentialHash = this.hashCredential(credential);
    return { worker: await this.repo.save(worker), credential };
  }

  async authenticate(
    id: string,
    credential: string | undefined,
  ): Promise<void> {
    if (!credential)
      throw new UnauthorizedException('invalid_worker_credential');
    const worker = await this.repo
      .createQueryBuilder('worker')
      .addSelect('worker.credentialHash')
      .where('worker.id = :id', { id })
      .getOne();
    if (!worker?.credentialHash) {
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
  }

  async heartbeat(
    id: string,
    capabilities: string[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repo.update(id, {
      capabilities: [...new Set(capabilities)],
      metadata: metadata as any,
      status: 'online',
      lastHeartbeat: new Date(),
    });
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
        `Marking worker ${worker.name} (${worker.id}) as offline — last heartbeat: ${worker.lastHeartbeat.toISOString()}`,
      );
    }

    await this.repo.save(staleWorkers);
    return staleWorkers.length;
  }

  private hashCredential(credential: string): string {
    return `sha256:${createHash('sha256').update(credential).digest('hex')}`;
  }
}
