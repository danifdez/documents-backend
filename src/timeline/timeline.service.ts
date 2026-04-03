import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimelineEntity } from './timeline.entity';
import { CreateTimelineDto, UpdateTimelineDto } from './dto/timeline.dto';

@Injectable()
export class TimelineService {
  constructor(
    @InjectRepository(TimelineEntity)
    private readonly repository: Repository<TimelineEntity>,
  ) { }

  async findOne(id: number): Promise<TimelineEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['project'],
    });
  }

  async findByProject(projectId: number): Promise<TimelineEntity[]> {
    return await this.repository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.projectId = :projectId', { projectId })
      .orderBy('t.updated_at', 'DESC')
      .getMany();
  }

  async create(dto: CreateTimelineDto): Promise<TimelineEntity> {
    const data: Partial<TimelineEntity> = { name: dto.name };
    if (dto.timelineData !== undefined) data.timelineData = dto.timelineData;
    if (dto.epochs !== undefined) data.epochs = dto.epochs;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.syncDatasetId !== undefined) data.syncDatasetId = dto.syncDatasetId;
    if (dto.syncMapping !== undefined) data.syncMapping = dto.syncMapping;
    if (dto.layoutType !== undefined) data.layoutType = dto.layoutType;
    if (dto.axisBreaks !== undefined) data.axisBreaks = dto.axisBreaks;
    if (dto.projectId) data.project = { id: dto.projectId } as any;
    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async update(id: number, dto: UpdateTimelineDto): Promise<TimelineEntity | null> {
    const data: Partial<TimelineEntity> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.timelineData !== undefined) data.timelineData = dto.timelineData;
    if (dto.epochs !== undefined) data.epochs = dto.epochs;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.syncDatasetId !== undefined) data.syncDatasetId = dto.syncDatasetId;
    if (dto.syncMapping !== undefined) data.syncMapping = dto.syncMapping;
    if (dto.layoutType !== undefined) data.layoutType = dto.layoutType;
    if (dto.axisBreaks !== undefined) data.axisBreaks = dto.axisBreaks;
    if (dto.projectId !== undefined) data.project = dto.projectId ? { id: dto.projectId } as any : null;
    const timeline = await this.repository.preload({ id, ...data });
    if (!timeline) return null;
    return await this.repository.save(timeline);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const timeline = await this.repository.findOneBy({ id });
    if (!timeline) return { deleted: false };
    await this.repository.remove(timeline);
    return { deleted: true };
  }
}
