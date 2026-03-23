import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
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
      this.logger.warn(`Marking worker ${worker.name} (${worker.id}) as offline — last heartbeat: ${worker.lastHeartbeat.toISOString()}`);
    }

    await this.repo.save(staleWorkers);
    return staleWorkers.length;
  }
}
