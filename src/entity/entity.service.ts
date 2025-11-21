import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityEntity, EntityAlias, EntityTranslation } from './entity.entity';
import { CreateEntityDto, UpdateEntityDto } from './dto/entity.dto';
import { EntityTypeService } from '../entity-type/entity-type.service';
import { ResourceService } from '../resource/resource.service';

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
            .limit(20)
            .getMany();

        return results;
    }

    async create(createEntityDto: CreateEntityDto): Promise<EntityEntity> {
        const entityType = await this.entityTypeService.findOne(createEntityDto.entityTypeId);
        if (!entityType) {
            throw new Error(`EntityType with id ${createEntityDto.entityTypeId} not found`);
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
                throw new Error(`EntityType with id ${updateEntityDto.entityTypeId} not found`);
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
            throw new Error(`Source entity with id ${sourceEntityId} not found`);
        }

        if (!targetEntity) {
            throw new Error(`Target entity with id ${targetEntityId} not found`);
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
        // Get resource with project relation
        const resource = await this.resourceService.findOne(resourceId);
        if (!resource) {
            return { document: [], project: [], global: [] };
        }

        const projectId = resource.project?.id;

        // Build base query
        let query = this.repository.createQueryBuilder('entity')
            .leftJoinAndSelect('entity.entityType', 'entityType')
            .leftJoin('resource_entities', 're', 're.entity_id = entity.id')
            .leftJoin('resources', 'r', 'r.id = re.resource_id')
            .leftJoin('projects', 'p', 'p.id = r.project_id');

        // Add search filter if provided
        if (searchTerm && searchTerm.trim().length > 0) {
            const trimmedTerm = searchTerm.trim();
            query = query.where(
                '(LOWER(entity.name) LIKE LOWER(:searchTerm) OR ' +
                'EXISTS (SELECT 1 FROM jsonb_array_elements(entity.aliases) AS alias_obj WHERE LOWER(alias_obj->>\'value\') LIKE LOWER(:searchTerm)) OR ' +
                'EXISTS (SELECT 1 FROM jsonb_each_text(entity.translations) AS trans(locale, name) WHERE LOWER(trans.name) LIKE LOWER(:searchTerm)))',
                { searchTerm: `%${trimmedTerm}%` }
            );
        }

        // Get all entities
        const allEntities = await query
            .orderBy('entity.name', 'ASC')
            .getMany();

        // Now categorize each entity based on its resource associations
        const documentEntities: EntityEntity[] = [];
        const projectEntities: EntityEntity[] = [];
        const globalEntities: EntityEntity[] = [];

        for (const entity of allEntities) {
            // Check if entity is associated with this specific resource (document scope)
            const isInDocument = await this.repository.createQueryBuilder('entity')
                .innerJoin('resource_entities', 're', 're.entity_id = entity.id')
                .where('entity.id = :entityId', { entityId: entity.id })
                .andWhere('re.resource_id = :resourceId', { resourceId })
                .getCount();

            if (isInDocument > 0) {
                documentEntities.push(entity);
                continue;
            }

            // Check if entity is associated with resources from the same project (project scope)
            if (projectId) {
                const isInProject = await this.repository.createQueryBuilder('entity')
                    .innerJoin('resource_entities', 're', 're.entity_id = entity.id')
                    .innerJoin('resources', 'r', 'r.id = re.resource_id')
                    .innerJoin('projects', 'p', 'p.id = r.project_id')
                    .where('entity.id = :entityId', { entityId: entity.id })
                    .andWhere('p.id = :projectId', { projectId })
                    .getCount();

                if (isInProject > 0) {
                    projectEntities.push(entity);
                    continue;
                }
            }

            // Check if entity has no resource associations (global scope)
            const resourceCount = await this.repository.createQueryBuilder('entity')
                .leftJoin('resource_entities', 're', 're.entity_id = entity.id')
                .where('entity.id = :entityId', { entityId: entity.id })
                .andWhere('re.resource_id IS NULL')
                .getCount();

            if (resourceCount > 0) {
                globalEntities.push(entity);
            }
        }

        return {
            document: documentEntities,
            project: projectEntities,
            global: globalEntities
        };
    }

    async findOrCreate(name: string, entityTypeName: string, aliases?: EntityAlias[]): Promise<EntityEntity> {
        // First try to find by name and type
        const entityType = await this.entityTypeService.findByName(entityTypeName);
        if (!entityType) {
            throw new Error(`EntityType '${entityTypeName}' not found`);
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