import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobService } from '../../../src/job/job.service';
import { JobEntity } from '../../../src/job/job.entity';
import { JobStatus } from '../../../src/job/job-status.enum';
import { JobPriority } from '../../../src/job/job-priority.enum';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildJob } from '../../factories';

describe('JobService', () => {
  let service: JobService;
  let repo: MockRepository<JobEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [JobService, { provide: getRepositoryToken(JobEntity), useValue: repo }],
    }).compile();
    service = module.get(JobService);
  });

  it('should create a job', async () => {
    const job = buildJob();
    repo.create.mockReturnValue(job);
    repo.save.mockResolvedValue(job);
    const result = await service.create('test', JobPriority.NORMAL, {});
    expect(result).toEqual(job);
  });

  it('should find all jobs', async () => {
    repo.find.mockResolvedValue([buildJob()]);
    expect(await service.findAll()).toHaveLength(1);
  });

  it('should find one by id', async () => {
    const job = buildJob();
    repo.findOneBy.mockResolvedValue(job);
    expect(await service.findOne(1)).toEqual(job);
  });

  it('should update status', async () => {
    const job = buildJob();
    repo.findOneBy.mockResolvedValue(job);
    repo.save.mockResolvedValue({ ...job, status: JobStatus.COMPLETED });
    const result = await service.updateStatus(1, JobStatus.COMPLETED);
    expect(result.status).toBe(JobStatus.COMPLETED);
  });

  it('should return null on update if not found', async () => {
    repo.findOneBy.mockResolvedValue(null);
    expect(await service.updateStatus(999, JobStatus.FAILED)).toBeNull();
  });

  it('should delete a job', async () => {
    const job = buildJob();
    repo.findOneBy.mockResolvedValue(job);
    repo.remove.mockResolvedValue(job);
    expect(await service.delete(1)).toEqual(job);
  });

  it('should delete expired jobs', async () => {
    const qb = repo.createQueryBuilder();
    qb.getMany.mockResolvedValue([buildJob()]);
    repo.remove.mockResolvedValue([]);
    const count = await service.deleteExpiredJobs();
    expect(count).toBe(1);
  });
});
