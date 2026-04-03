import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSourceEntity } from './data-source.entity';
import { DataSourceSyncLogEntity } from './data-source-sync-log.entity';
import { DataSourceEncryptionService } from './data-source-encryption.service';
import { DataSourceProviderFactory } from './data-source-provider.factory';
import { CreateDataSourceDto, UpdateDataSourceDto } from './dto/data-source.dto';

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
        const qb = this.repo.createQueryBuilder('ds')
            .leftJoinAndSelect('ds.project', 'project')
            .leftJoinAndSelect('ds.dataset', 'dataset')
            .orderBy('ds.name', 'ASC');

        if (projectId) {
            qb.where('ds.project.id = :projectId', { projectId });
        }

        const sources = await qb.getMany();
        return sources.map(s => this.sanitize(s));
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
            throw new BadRequestException(`Unknown provider type: ${dto.providerType}`);
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
            credentials: dto.credentials ? this.encryptionService.encrypt(dto.credentials) : null,
            schemaMapping: dto.schemaMapping || null,
            syncSchedule: dto.syncSchedule || null,
            syncStrategy: dto.syncStrategy || 'full',
            incrementalKey: dto.incrementalKey || null,
            enabled: dto.enabled !== undefined ? dto.enabled : true,
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
            const provider = this.providerFactory.getProvider(ds.providerType);
            if (provider) {
                const errors = provider.validateConfig(dto.config);
                if (errors.length > 0) {
                    throw new BadRequestException(`Invalid config: ${errors.join(', ')}`);
                }
            }
            ds.config = dto.config;
        }
        if (dto.credentials !== undefined) {
            ds.credentials = dto.credentials ? this.encryptionService.encrypt(dto.credentials) : null;
        }
        if (dto.schemaMapping !== undefined) ds.schemaMapping = dto.schemaMapping || null;
        if (dto.syncSchedule !== undefined) ds.syncSchedule = dto.syncSchedule || null;
        if (dto.syncStrategy !== undefined) ds.syncStrategy = dto.syncStrategy;
        if (dto.incrementalKey !== undefined) ds.incrementalKey = dto.incrementalKey || null;
        if (dto.enabled !== undefined) ds.enabled = dto.enabled;
        if (dto.rateLimitRpm !== undefined) ds.rateLimitRpm = dto.rateLimitRpm || null;
        if (dto.projectId !== undefined) {
            ds.project = dto.projectId ? { id: dto.projectId } as any : null;
        }

        const saved = await this.repo.save(ds);
        return this.sanitize(saved);
    }

    async remove(id: number): Promise<void> {
        const ds = await this.findOne(id);
        await this.repo.remove(ds);
    }

    async getSyncLogs(dataSourceId: number, limit = 20): Promise<DataSourceSyncLogEntity[]> {
        return this.syncLogRepo.find({
            where: { dataSource: { id: dataSourceId } },
            order: { startedAt: 'DESC' },
            take: limit,
        });
    }

    async findAllWithSchedule(): Promise<DataSourceEntity[]> {
        return this.repo.find({
            where: { enabled: true },
            relations: ['dataset'],
        });
    }

    getDecryptedCredentials(ds: DataSourceEntity): Record<string, any> | null {
        if (!ds.credentials) return null;
        try {
            return this.encryptionService.decrypt(ds.credentials);
        } catch {
            return null;
        }
    }

    private sanitize(ds: DataSourceEntity): any {
        const result: any = { ...ds };
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
}
