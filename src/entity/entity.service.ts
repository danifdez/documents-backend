import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityEntity, EntityAlias, EntityTranslation } from './entity.entity';
import { CreateEntityDto, UpdateEntityDto } from './dto/entity.dto';
import { EntityTypeService } from '../entity-type/entity-type.service';
import { ResourceService } from '../resource/resource.service';
import { DEFAULT_SEARCH_LIMIT } from '../common/constants';

@Injectable()
export class EntityService {
    constructor(
        @InjectRepository(EntityEntity)
        private readonly repository: Repository<EntityEntity>,
        private readonly entityTypeService: EntityTypeService,
        private readonly resourceService: ResourceService,
    ) { }

    async findAll(): Promise<EntityEntity[]> {
        return await this.repository.find({
            relations: ['entityType'],
            order: { name: 'ASC' }
        });
    }

    async findOne(id: number): Promise<EntityEntity | null> {
        return await this.repository.findOne({
            where: { id },
            relations: ['entityType', 'resources']
        });
    }

    async findOneDetailed(id: number): Promise<any | null> {
        const entity = await this.repository.findOne({
            where: { id },
            relations: ['entityType', 'projects']
        });

        if (!entity) return null;

        const resources = await this.repository.query(
            `SELECT r.id, r.name, r.type, r.status,
                    p.id as "projectId", p.name as "projectName"
             FROM resource_entities re
             JOIN resources r ON r.id = re.resource_id
             LEFT JOIN projects p ON p.id = r."projectId"
             WHERE re.entity_id = $1
             ORDER BY r.name ASC`,
            [id]
        );

        return {
            ...entity,
            resources: resources.map((r: any) => ({
                id: r.id,
                name: r.name,
                type: r.type,
                status: r.status,
                project: r.projectId ? { id: r.projectId, name: r.projectName } : null,
            })),
        };
    }

    async findByName(name: string): Promise<EntityEntity | null> {
        return await this.repository.findOne({
            where: { name },
            relations: ['entityType']
        });
    }

    async findByNameAndType(name: string, entityTypeId: number): Promise<EntityEntity | null> {
        return await this.repository.findOne({
            where: {
                name,
                entityType: { id: entityTypeId }
            },
            relations: ['entityType']
        });
    }

    async findByNameTypeAndLocale(name: string, entityTypeId: number, locale: string): Promise<EntityEntity | null> {
        // Try to find an entity that matches the name and entityType and has a translation or alias with the same locale.
        const qb = this.repository.createQueryBuilder('entity')
            .leftJoinAndSelect('entity.entityType', 'entityType')
            .where('entity.name = :name', { name })
            .andWhere('entityType.id = :entityTypeId', { entityTypeId })
            .limit(1);

        // Check translations JSONB for the locale
        qb.orWhere(`(entity.translations ->> :locale) = :name`, { locale, name });

        // Also check aliases array for matching locale and value
        qb.orWhere(`EXISTS (SELECT 1 FROM jsonb_array_elements(entity.aliases) AS alias_obj WHERE alias_obj->>'locale' = :locale AND alias_obj->>'value' = :name)`, { locale, name });

        const res = await qb.getOne();
        return res || null;
    }

    async globalSearch(searchTerm: string, projectId?: number): Promise<any[]> {
        if (!searchTerm || searchTerm.trim() === '') return [];
        const like = `%${searchTerm}%`;
        const qb = this.repository
            .createQueryBuilder('e')
            .select(['e.id', 'e.name', 'e.description'])
            .addSelect('similarity(unaccent(e.name), unaccent(:s))', 'score')
            .where('unaccent(e.name) ILIKE unaccent(:q) OR unaccent(e.description) ILIKE unaccent(:q)', { q: like })
            .setParameter('s', searchTerm);
        if (projectId) {
            qb.innerJoin('entity_projects', 'ep', 'ep.entity_id = e.id')
              .andWhere('ep.project_id = :projectId', { projectId });
        }
        return await qb.orderBy('score', 'DESC').limit(50).getRawMany();
    }

    async searchByName(searchTerm: string): Promise<EntityEntity[]> {
        if (!searchTerm || searchTerm.trim().length === 0) {
            return [];
        }

        const trimmedTerm = searchTerm.trim();

        const results = await this.repository.createQueryBuilder('entity')
            .leftJoinAndSelect('entity.entityType', 'entityType')
            .where('LOWER(entity.name) LIKE LOWER(:searchTerm)', {
                searchTerm: `%${trimmedTerm}%`
            })
            .orWhere(
                `EXISTS (
                    SELECT 1 FROM jsonb_array_elements(entity.aliases) AS alias_obj
                    WHERE LOWER(alias_obj->>'value') LIKE LOWER(:searchTerm)
                )`, {
                searchTerm: `%${trimmedTerm}%`
            })
            .orWhere(
                `EXISTS (
                    SELECT 1 FROM jsonb_each_text(entity.translations) AS trans(locale, name)
                    WHERE LOWER(trans.name) LIKE LOWER(:searchTerm)
                )`, {
                searchTerm: `%${trimmedTerm}%`
            })
            .orderBy('entity.name', 'ASC')
            .limit(DEFAULT_SEARCH_LIMIT)
            .getMany();

        return results;
    }

    async create(createEntityDto: CreateEntityDto): Promise<EntityEntity> {
        const entityType = await this.entityTypeService.findOne(createEntityDto.entityTypeId);
        if (!entityType) {
            throw new NotFoundException(`EntityType with id ${createEntityDto.entityTypeId} not found`);
        }

        const entity = this.repository.create({
            name: createEntityDto.name,
            translations: createEntityDto.translations,
            aliases: createEntityDto.aliases,
            entityType,
            global: createEntityDto.global ?? false,
        });

        const savedEntity = await this.repository.save(entity);

        // If projectIds are provided, associate the entity with those projects
        if (createEntityDto.projectIds && createEntityDto.projectIds.length > 0) {
            await this.repository
                .createQueryBuilder()
                .insert()
                .into('entity_projects')
                .values(
                    createEntityDto.projectIds.map(projectId => ({
                        entity_id: savedEntity.id,
                        project_id: projectId,
                    }))
                )
                .execute();
        }

        return savedEntity;
    }

    async update(id: number, updateEntityDto: UpdateEntityDto): Promise<EntityEntity | null> {
        const existingEntity = await this.repository.findOne({
            where: { id },
            relations: ['entityType']
        });

        if (!existingEntity) {
            return null;
        }

        if (updateEntityDto.entityTypeId && updateEntityDto.entityTypeId !== existingEntity.entityType.id) {
            const entityType = await this.entityTypeService.findOne(updateEntityDto.entityTypeId);
            if (!entityType) {
                throw new NotFoundException(`EntityType with id ${updateEntityDto.entityTypeId} not found`);
            }
            existingEntity.entityType = entityType;
        }

        if (updateEntityDto.name !== undefined) {
            existingEntity.name = updateEntityDto.name;
        }

        if (updateEntityDto.description !== undefined) {
            existingEntity.description = updateEntityDto.description;
        }

        if (updateEntityDto.translations !== undefined) {
            existingEntity.translations = updateEntityDto.translations;
        }

        if (updateEntityDto.aliases !== undefined) {
            existingEntity.aliases = updateEntityDto.aliases;
        }

        if (updateEntityDto.global !== undefined) {
            existingEntity.global = updateEntityDto.global;
        }

        const savedEntity = await this.repository.save(existingEntity);

        // Update project associations if projectIds are provided
        if (updateEntityDto.projectIds !== undefined) {
            // First, remove all existing project associations
            await this.repository
                .createQueryBuilder()
                .delete()
                .from('entity_projects')
                .where('entity_id = :entityId', { entityId: id })
                .execute();

            // Then, add new project associations
            if (updateEntityDto.projectIds.length > 0) {
                await this.repository
                    .createQueryBuilder()
                    .insert()
                    .into('entity_projects')
                    .values(
                        updateEntityDto.projectIds.map(projectId => ({
                            entity_id: id,
                            project_id: projectId,
                        }))
                    )
                    .execute();
            }
        }

        return savedEntity;
    }

    /**
     * Update only the translations JSONB column for an entity using a direct query
     * to avoid triggering relation metadata handling in TypeORM save routines.
     */
    async updateTranslations(id: number, translations: EntityTranslation): Promise<EntityEntity | null> {
        await this.repository.createQueryBuilder()
            .update()
            .set({ translations: Object.keys(translations).length > 0 ? translations : null })
            .where('id = :id', { id })
            .execute();

        return await this.findOne(id);
    }

    /**
     * Merge new translations into the existing translations JSONB column using SQL jsonb concatenation.
     * This avoids loading the entity and touching relation metadata.
     */
    async mergeTranslations(id: number, translations: EntityTranslation): Promise<EntityEntity | null> {
        // If there are no translations to merge, just return the entity
        if (!translations || Object.keys(translations).length === 0) {
            return await this.findOne(id);
        }

        // Use raw SQL to merge JSONB objects (existing translations || new translations)
        await this.repository.query(
            `UPDATE entities SET translations = COALESCE(translations, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
            [JSON.stringify(translations), id]
        );

        return await this.findOne(id);
    }

    /**
     * Merge new translations into the existing translations JSONB column using SQL jsonb concatenation.
     * This version does not return the entity to avoid loading relations.
     */
    async mergeTranslationsOnly(id: number, translations: EntityTranslation): Promise<void> {
        // If there are no translations to merge, do nothing
        if (!translations || Object.keys(translations).length === 0) {
            return;
        }

        // Use raw SQL to merge JSONB objects (existing translations || new translations)
        await this.repository.query(
            `UPDATE entities SET translations = COALESCE(translations, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
            [JSON.stringify(translations), id]
        );
    }

    async remove(id: number): Promise<void> {
        await this.repository.delete({ id });
    }

    async merge(sourceEntityId: number, targetEntityId: number): Promise<EntityEntity> {
        // Find both entities (don't load resources relation as it's the inverse side)
        const sourceEntity = await this.repository.findOne({
            where: { id: sourceEntityId },
            relations: ['entityType']
        });

        const targetEntity = await this.repository.findOne({
            where: { id: targetEntityId },
            relations: ['entityType']
        });

        if (!sourceEntity) {
            throw new NotFoundException(`Source entity with id ${sourceEntityId} not found`);
        }

        if (!targetEntity) {
            throw new NotFoundException(`Target entity with id ${targetEntityId} not found`);
        }

        // Merge aliases with locale information
        const sourceAliases = sourceEntity.aliases || [];
        const targetAliases = targetEntity.aliases || [];

        // Create a map for easier duplicate checking
        const aliasMap = new Map<string, EntityAlias>();

        // Add target aliases first
        targetAliases.forEach(alias => {
            const key = `${alias.locale}:${alias.value}`;
            aliasMap.set(key, alias);
        });

        // Add source entity name as alias (assuming default locale 'en' if not specified)
        const sourceNameAlias: EntityAlias = { locale: 'en', value: sourceEntity.name };
        const sourceNameKey = `${sourceNameAlias.locale}:${sourceNameAlias.value}`;
        if (!aliasMap.has(sourceNameKey)) {
            aliasMap.set(sourceNameKey, sourceNameAlias);
        }

        // Add source aliases that aren't already present
        sourceAliases.forEach(alias => {
            const key = `${alias.locale}:${alias.value}`;
            if (!aliasMap.has(key)) {
                aliasMap.set(key, alias);
            }
        });

        // Also add every translation from the source entity as an alias
        // (locale -> value). This ensures all translated names become searchable as aliases.
        const sourceTranslationsForAliases = sourceEntity.translations || {};
        Object.keys(sourceTranslationsForAliases).forEach(locale => {
            const value = sourceTranslationsForAliases[locale];
            if (value && value.trim().length > 0) {
                const alias: EntityAlias = { locale, value };
                const key = `${alias.locale}:${alias.value}`;
                if (!aliasMap.has(key)) {
                    aliasMap.set(key, alias);
                }
            }
        });


        // Merge translations
        const sourceTranslations = sourceEntity.translations || {};
        const targetTranslations = targetEntity.translations || {};
        const mergedTranslations: EntityTranslation = { ...targetTranslations };

        // Add source translations that don't conflict with target translations
        Object.keys(sourceTranslations).forEach(locale => {
            if (!mergedTranslations[locale]) {
                mergedTranslations[locale] = sourceTranslations[locale];
            }
        });

        // Add all source translations as aliases as well (e.g. { es: 'Nombre' } -> alias { locale: 'es', value: 'Nombre' })
        Object.entries(sourceTranslations).forEach(([locale, translatedValue]) => {
            if (!translatedValue) return;
            const key = `${locale}:${translatedValue}`;
            if (!aliasMap.has(key)) {
                aliasMap.set(key, { locale, value: translatedValue });
            }
        });

        // Also ensure that translations are represented in aliases for the target if missing
        // (so searching by translated name via aliases works consistently)
        const finalAliases = Array.from(aliasMap.values());
        Object.entries(mergedTranslations).forEach(([locale, value]) => {
            if (!value) return;
            const key = `${locale}:${value}`;
            if (!aliasMap.has(key)) {
                finalAliases.push({ locale, value });
                aliasMap.set(key, { locale, value });
            }
        });

        // Update target entity with merged data
        targetEntity.aliases = finalAliases.length > 0 ? finalAliases : null;
        targetEntity.translations = Object.keys(mergedTranslations).length > 0 ? mergedTranslations : null;
        await this.repository.save(targetEntity);

        // Move all resource relationships from source to target
        // Update relationships that don't already exist for the target entity
        await this.repository.query(
            `UPDATE resource_entities 
             SET entity_id = $1 
             WHERE entity_id = $2 
             AND NOT EXISTS (
                 SELECT 1 FROM resource_entities re2 
                 WHERE re2.resource_id = resource_entities.resource_id 
                 AND re2.entity_id = $1
             )`,
            [targetEntityId, sourceEntityId]
        );

        // Delete any remaining relationships for the source entity
        await this.repository.query(
            'DELETE FROM resource_entities WHERE entity_id = $1',
            [sourceEntityId]
        );

        // Delete the source entity
        await this.repository.delete({ id: sourceEntityId });

        return targetEntity;
    }

    async findByResourceGroupedByScope(
        resourceId: number,
        searchTerm?: string
    ): Promise<{
        document: EntityEntity[];
        project: EntityEntity[];
        global: EntityEntity[];
    }> {
        const resource = await this.resourceService.findOne(resourceId);
        if (!resource) {
            return { document: [], project: [], global: [] };
        }

        const projectId = resource.project?.id;

        // Single query that classifies entities by scope using subqueries
        // instead of N+1 individual queries per entity
        let query = this.repository.createQueryBuilder('entity')
            .leftJoinAndSelect('entity.entityType', 'entityType')
            .addSelect(`(
                SELECT COUNT(*) FROM resource_entities re_doc
                WHERE re_doc.entity_id = entity.id AND re_doc.resource_id = :resourceId
            )`, 'in_document_count')
            .setParameter('resourceId', resourceId);

        if (projectId) {
            query = query.addSelect(`(
                SELECT COUNT(*) FROM resource_entities re_proj
                JOIN resources r_proj ON r_proj.id = re_proj.resource_id
                WHERE re_proj.entity_id = entity.id AND r_proj."projectId" = :projectId
            )`, 'in_project_count')
            .setParameter('projectId', projectId);
        }

        query = query.addSelect(`(
            SELECT COUNT(*) FROM resource_entities re_any
            WHERE re_any.entity_id = entity.id
        )`, 'total_resource_count');

        if (searchTerm && searchTerm.trim().length > 0) {
            const trimmedTerm = searchTerm.trim();
            query = query.where(
                '(LOWER(entity.name) LIKE LOWER(:searchTerm) OR ' +
                'EXISTS (SELECT 1 FROM jsonb_array_elements(entity.aliases) AS alias_obj WHERE LOWER(alias_obj->>\'value\') LIKE LOWER(:searchTerm)) OR ' +
                'EXISTS (SELECT 1 FROM jsonb_each_text(entity.translations) AS trans(locale, name) WHERE LOWER(trans.name) LIKE LOWER(:searchTerm)))',
                { searchTerm: `%${trimmedTerm}%` }
            );
        }

        const rawResults = await query
            .orderBy('entity.name', 'ASC')
            .getRawAndEntities();

        const documentEntities: EntityEntity[] = [];
        const projectEntities: EntityEntity[] = [];
        const globalEntities: EntityEntity[] = [];

        for (let i = 0; i < rawResults.entities.length; i++) {
            const entity = rawResults.entities[i];
            const raw = rawResults.raw[i];

            const inDocCount = parseInt(raw.in_document_count, 10) || 0;
            const inProjectCount = projectId ? (parseInt(raw.in_project_count, 10) || 0) : 0;
            const totalCount = parseInt(raw.total_resource_count, 10) || 0;

            if (inDocCount > 0) {
                documentEntities.push(entity);
            } else if (projectId && inProjectCount > 0) {
                projectEntities.push(entity);
            } else if (totalCount === 0) {
                globalEntities.push(entity);
            }
        }

        return {
            document: documentEntities,
            project: projectEntities,
            global: globalEntities,
        };
    }

    async findOrCreate(name: string, entityTypeName: string, aliases?: EntityAlias[]): Promise<EntityEntity> {
        // First try to find by name and type
        const entityType = await this.entityTypeService.findByName(entityTypeName);
        if (!entityType) {
            throw new NotFoundException(`EntityType '${entityTypeName}' not found`);
        }

        let entity = await this.findByNameAndType(name, entityType.id);

        if (!entity) {
            entity = await this.create({
                name,
                entityTypeId: entityType.id,
                aliases
            });
        }

        return entity;
    }

    async addProjectToEntity(entityId: number, projectId: number): Promise<void> {
        // Check if relation already exists
        const existing = await this.repository
            .createQueryBuilder()
            .select('1')
            .from('entity_projects', 'ep')
            .where('ep.entity_id = :entityId', { entityId })
            .andWhere('ep.project_id = :projectId', { projectId })
            .getRawOne();

        if (!existing) {
            await this.repository
                .createQueryBuilder()
                .insert()
                .into('entity_projects')
                .values({
                    entity_id: entityId,
                    project_id: projectId,
                })
                .execute();
        }
    }
}