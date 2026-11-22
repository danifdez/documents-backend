import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSourceEntity } from './data-source.entity';
import { DataSourceSyncLogEntity } from './data-source-sync-log.entity';
import { DataSourceEncryptionService } from './data-source-encryption.service';
import { DataSourceProviderFactory } from './data-source-provider.factory';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from './dto/data-source.dto';

const MASKED_VALUE = '****';
const SENSITIVE_CONFIG_KEY =
  /(api[-_]?key|token|secret|password|authorization|auth|cookie)/i;

@Injectable()
export class DataSourceService {
  constructor(
    @InjectRepository(DataSourceEntity)
    private readonly repo: Repository<DataSourceEntity>,
    @InjectRepository(DataSourceSyncLogEntity)
    private readonly syncLogRepo: Repository<DataSourceSyncLogEntity>,
    private readonly encryptionService: DataSourceEncryptionService,
    private readonly providerFactory: DataSourceProviderFactory,
  ) {}

  async findAll(projectId?: number): Promise<any[]> {
    const qb = this.repo
      .createQueryBuilder('ds')
      .leftJoinAndSelect('ds.project', 'project')
      .leftJoinAndSelect('ds.dataset', 'dataset')
      .orderBy('ds.name', 'ASC');

    if (projectId) {
      qb.where('ds.project.id = :projectId', { projectId });
    }

    const sources = await qb.getMany();
    return sources.map((s) => this.sanitize(s));
  }

  async findOne(id: number): Promise<DataSourceEntity> {
    const ds = await this.repo.findOne({
      where: { id },
      relations: ['project', 'dataset'],
    });
    if (!ds) throw new NotFoundException(`Data source ${id} not found`);
    return ds;
  }

  async findOnePublic(id: number): Promise<any> {
    return this.sanitize(await this.findOne(id));
  }

  async create(dto: CreateDataSourceDto): Promise<any> {
    const provider = this.providerFactory.getProvider(dto.providerType);
    if (!provider) {
      throw new BadRequestException(
        `Unknown provider type: ${dto.providerType}`,
      );
    }

    const errors = provider.validateConfig(dto.config);
    if (errors.length > 0) {
      throw new BadRequestException(`Invalid config: ${errors.join(', ')}`);
    }

    const entity = this.repo.create({
      name: dto.name,
      description: dto.description || null,
      providerType: dto.providerType,
      config: dto.config,
      credentials: dto.credentials
        ? this.encryptionService.encrypt(dto.credentials)
        : null,
      schemaMapping: dto.schemaMapping || null,
      syncSchedule: dto.syncSchedule || null,
      syncStrategy: dto.syncStrategy || 'full',
      incrementalKey: dto.incrementalKey || null,
      enabled: dto.enabled ?? true,
      rateLimitRpm: dto.rateLimitRpm || null,
    });

    if (dto.projectId) {
      entity.project = { id: dto.projectId } as any;
    }

    const saved = await this.repo.save(entity);
    return this.sanitize(saved);
  }

  async update(id: number, dto: UpdateDataSourceDto): Promise<any> {
    const ds = await this.findOne(id);

    if (dto.name !== undefined) ds.name = dto.name;
    if (dto.description !== undefined) ds.description = dto.description || null;
    if (dto.config !== undefined) {
      const mergedConfig = this.mergeConfig(ds.config, dto.config);
      const errors = this.providerFactory
        .getProvider(ds.providerType)
        ?.validateConfig(mergedConfig);
      if (errors?.length) {
        throw new BadRequestException(`Invalid config: ${errors.join(', ')}`);
      }
      ds.config = mergedConfig;
    }
    if (dto.credentials !== undefined) {
      ds.credentials = dto.credentials
        ? this.encryptionService.encrypt(dto.credentials)
        : null;
    }
    if (dto.schemaMapping !== undefined)
      ds.schemaMapping = dto.schemaMapping || null;
    this.applySyncOptions(ds, dto);
    if (dto.projectId !== undefined) {
      ds.project = dto.projectId ? ({ id: dto.projectId } as any) : null;
    }

    const saved = await this.repo.save(ds);
    return this.sanitize(saved);
  }

  private applySyncOptions(
    ds: DataSourceEntity,
    dto: UpdateDataSourceDto,
  ): void {
    if (dto.syncSchedule !== undefined)
      ds.syncSchedule = dto.syncSchedule || null;
    if (dto.syncStrategy !== undefined) ds.syncStrategy = dto.syncStrategy;
    if (dto.incrementalKey !== undefined)
      ds.incrementalKey = dto.incrementalKey || null;
    if (dto.enabled !== undefined) ds.enabled = dto.enabled;
    if (dto.rateLimitRpm !== undefined)
      ds.rateLimitRpm = dto.rateLimitRpm || null;
  }

  async remove(id: number): Promise<void> {
    const ds = await this.findOne(id);
    await this.repo.remove(ds);
  }

  getSyncLogs(
    dataSourceId: number,
    limit = 20,
  ): Promise<DataSourceSyncLogEntity[]> {
    return this.syncLogRepo.find({
      where: { dataSource: { id: dataSourceId } },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  findAllWithSchedule(): Promise<DataSourceEntity[]> {
    return this.repo.find({
      where: { enabled: true },
      relations: ['dataset'],
    });
  }

  getDecryptedCredentials(ds: DataSourceEntity): Record<string, any> | null {
    if (!ds.credentials) return null;
    return this.encryptionService.decrypt(ds.credentials);
  }

  private sanitize(ds: DataSourceEntity): any {
    const result: any = {
      ...ds,
      config: this.sanitizeConfig(ds.config),
    };
    if (ds.credentials) {
      try {
        const decrypted = this.encryptionService.decrypt(ds.credentials);
        result.credentials = this.encryptionService.mask(decrypted);
      } catch {
        result.credentials = { status: 'encrypted' };
      }
    }
    result.hasCredentials = !!ds.credentials;
    return result;
  }

  private sanitizeConfig(config: Record<string, any>): Record<string, any> {
    return this.maskValue(config) as Record<string, any>;
  }

  private maskValue(value: any, key?: string): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskValue(item));
    }
    if (value && typeof value === 'object') {
      const masked: Record<string, any> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        masked[childKey] = this.maskValue(childValue, childKey);
      }
      return masked;
    }
    if (typeof value === 'string') {
      if (key && SENSITIVE_CONFIG_KEY.test(key)) return MASKED_VALUE;
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.stringify(this.maskValue(JSON.parse(trimmed)));
        } catch {
          return value;
        }
      }
    }
    return value;
  }

  /**
   * Keeps previously stored secrets when the client sends back the masked
   * value it received from `findAll`/`findOnePublic`.
   */
  private mergeConfig(existing: any, incoming: any): any {
    if (incoming === MASKED_VALUE) return existing;

    if (Array.isArray(incoming)) {
      return incoming.map((item, index) =>
        this.mergeConfig(
          Array.isArray(existing) ? existing[index] : undefined,
          item,
        ),
      );
    }

    if (incoming && typeof incoming === 'object') {
      const current =
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? existing
          : {};
      const updates = Object.entries(incoming).map(([key, value]) => [
        key,
        this.mergeConfig(
          Object.hasOwn(current, key) ? current[key] : undefined,
          value,
        ),
      ]);
      return { ...current, ...Object.fromEntries(updates) };
    }

    return typeof incoming === 'string'
      ? this.mergeConfigString(existing, incoming)
      : incoming;
  }

  private mergeConfigString(existing: unknown, incoming: string): string {
    const trimmed = incoming.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return incoming;
    try {
      const previous =
        typeof existing === 'string' ? JSON.parse(existing) : existing;
      return JSON.stringify(this.mergeConfig(previous, JSON.parse(trimmed)));
    } catch {
      return incoming;
    }
  }
}
