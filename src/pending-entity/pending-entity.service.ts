import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PendingEntityEntity, EntityAlias, EntityScope, EntityTranslation } from './pending-entity.entity';
import { EntityService } from '../entity/entity.service';
import { ResourceService } from '../resource/resource.service';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { readFeaturesFromEnv } from '../common/feature-flags';

export interface CreatePendingEntityDto {
    resourceId: number;
    name: string;
    description?: string;
    entityTypeId?: number;
    aliases?: EntityAlias[];
    scope?: EntityScope;
    translations?: EntityTranslation;
    contextSelection?: {
        text: string;
        startOffset?: number;
        endOffset?: number;
        source?: 'content' | 'translation';
    };
}

export interface UpdatePendingEntityDto {
    name?: string;
    description?: string;
    entityTypeId?: number;
    aliases?: EntityAlias[];
    scope?: EntityScope;
    translations?: EntityTranslation;
}

@Injectable()
export class PendingEntityService {
    constructor(
        @InjectRepository(PendingEntityEntity)
        private readonly repository: Repository<PendingEntityEntity>,
        private readonly entityService: EntityService,
        private readonly resourceService: ResourceService,
        private readonly jobService: JobService,
    ) { }

    // Helper to escape strings for use in RegExp
    private escapeRegExp(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async findAll(): Promise<PendingEntityEntity[]> {
        return await this.repository.find({
            relations: ['entityType', 'resource'],
            order: { createdAt: 'DESC' }
        });
    }

    async findByResourceId(resourceId: number): Promise<(PendingEntityEntity & { isConfirmed?: boolean })[]> {
        const pendingEntities = await this.repository.find({
            where: { resourceId },
            relations: ['entityType'],
            order: { name: 'ASC' }
        });

        // Check if each pending entity already exists as a confirmed entity
        const entitiesWithStatus = await Promise.all(
            pendingEntities.map(async (pending) => {
                if (!pending.entityType) {
                    return { ...pending, isConfirmed: false };
                }

                // Check if entity exists with same name, type and language (if language present)
                let existingEntity = null;
                if (pending.language) {
                    if ((this.entityService as any).findByNameTypeAndLocale) {
                        existingEntity = await (this.entityService as any).findByNameTypeAndLocale(pending.name, pending.entityType.id, pending.language);
                    }
                }

                if (!existingEntity) {
                    existingEntity = await this.entityService.findByNameAndType(
                        pending.name,
                        pending.entityType.id
                    );
                }

                return {
                    ...pending,
                    isConfirmed: !!existingEntity
                };
            })
        );

        return entitiesWithStatus;
    }

    async findOne(id: number): Promise<PendingEntityEntity | null> {
        return await this.repository.findOne({
            where: { id },
            relations: ['entityType', 'resource']
        });
    }

    async create(dto: CreatePendingEntityDto): Promise<PendingEntityEntity> {
        // Resolve resource to obtain language
        const resource = await this.resourceService.findOne(dto.resourceId);

        const partial: Partial<PendingEntityEntity> = {
            resource: { id: dto.resourceId } as any,
            name: dto.name,
            aliases: dto.aliases || null,
            scope: dto.scope || 'document',
            entityType: dto.entityTypeId ? { id: dto.entityTypeId } as any : null,
            language: resource ? resource.language : null,
            translations: dto.translations || null,
        };

        const pendingEntity = this.repository.create(partial as any);
        return await this.repository.save(pendingEntity as any);
    }

    async update(id: number, dto: UpdatePendingEntityDto): Promise<PendingEntityEntity | null> {
        const existing = await this.repository.findOneBy({ id });
        if (!existing) return null;

        if (dto.name !== undefined) existing.name = dto.name;
        if (dto.aliases !== undefined) existing.aliases = dto.aliases;
        if (dto.scope !== undefined) existing.scope = dto.scope;
        if (dto.translations !== undefined) existing.translations = dto.translations;
        if (dto.entityTypeId !== undefined) {
            existing.entityType = dto.entityTypeId ? { id: dto.entityTypeId } as any : null;
        }

        return await this.repository.save(existing);
    }

    async remove(id: number): Promise<PendingEntityEntity | null> {
        const entity = await this.repository.findOneBy({ id });
        if (!entity) return null;
        await this.repository.remove(entity);
        return entity;
    }

    async confirmEntities(resourceId: number): Promise<{ confirmed: number; errors: string[] }> {
        const allPendingEntities = await this.findByResourceId(resourceId);

        // Filter only entities that are not merged
        const pendingEntities = allPendingEntities.filter(e => e.status !== 'merged');

        let confirmed = 0;
        const errors: string[] = [];

        // Get the resource to check language and working content
        const resource = await this.resourceService.findOne(resourceId);
        if (!resource) {
            throw new Error(`Resource with id ${resourceId} not found`);
        }

        let workingContent = resource.workingContent || '';
        let contentWasModified = false;

        // Build a map of entity names and their aliases that need to be replaced
        const replacements: Array<{ from: string; to: string }> = [];

        for (const pending of pendingEntities) {
            try {
                // Get all aliases from the entity
                const allAliases = pending.aliases || [];

                // Find or create the entity in the main entities table
                const entityTypeName = pending.entityType?.name;
                if (!entityTypeName) {
                    throw new Error(`Entity type is required for "${pending.name}"`);
                }

                // Find existing entity or create new one
                let entity = await this.entityService.findByNameAndType(pending.name, pending.entityType.id);

                if (!entity) {
                    // Create new entity with appropriate scope
                    const createDto: any = {
                        name: pending.name,
                        entityTypeId: pending.entityType.id,
                        aliases: allAliases.length > 0 ? allAliases : undefined,
                    };

                    // Set global flag if scope is global
                    if (pending.scope === 'global') {
                        createDto.global = true;
                    }

                    // Set projectIds if scope is project
                    if (pending.scope === 'project' && resource.project) {
                        const projectId = typeof resource.project === 'object' ? resource.project.id : resource.project;
                        createDto.projectIds = [projectId];
                    }

                    entity = await this.entityService.create(createDto);
                } else {
                    // Entity exists, update scope if needed
                    if (pending.scope === 'global' && !entity.global) {
                        await this.entityService.update(entity.id, { global: true });
                        entity.global = true;
                    }

                    // If scope is project, ensure entity-project relation exists
                    if (pending.scope === 'project' && resource.project) {
                        const projectId = typeof resource.project === 'object' ? resource.project.id : resource.project;
                        // Add project relation (this will be handled by addProjectToEntity method)
                        await this.entityService['addProjectToEntity'](entity.id, projectId);
                    }
                }

                // Add aliases to replacements if they exist
                if (allAliases.length > 0) {
                    for (const alias of allAliases) {
                        if (alias.value !== pending.name && alias.scope === 'document') {
                            // This alias should be replaced in working_content
                            replacements.push({
                                from: alias.value,
                                to: pending.name,
                            });
                        }
                    }
                }

                // Always link entity to resource (creates resource_entities relation)
                await this.resourceService.addEntityToResource(resourceId, entity);

                // Remove the pending entity from database
                await this.repository.remove(pending);
                confirmed++;
            } catch (error) {
                errors.push(`Failed to confirm entity "${pending.name}": ${error.message}`);
            }
        }

        // Apply replacements to working_content (replace aliases with main entity names)
        if (replacements.length > 0 && workingContent) {
            for (const replacement of replacements) {
                const pattern = new RegExp(`\\b${this.escapeRegExp(replacement.from)}\\b`, 'gi');
                const newContent = workingContent.replace(pattern, replacement.to);
                if (newContent !== workingContent) {
                    workingContent = newContent;
                    contentWasModified = true;
                }
            }

            // Save updated working_content if it was modified
            if (contentWasModified) {
                await this.resourceService.update(resourceId, { workingContent });
            }
        }

        // If content was modified and resource language is not English, trigger new translation
        if (contentWasModified && resource.language && resource.language !== 'en') {
            try {
                // Create a translation job for the updated working_content
                await this.jobService.create('translate', JobPriority.NORMAL, {
                    translationType: 'content',
                    resourceId,
                    sourceLanguage: 'en',
                    targetLanguage: resource.language,
                    texts: [{ text: workingContent }],
                });
            } catch (error) {
                errors.push(`Failed to create translation job after updating working_content: ${error.message}`);
            }
        }

        // Update resource status to 'confirmed' and launch ingest-content job
        await this.resourceService.update(resourceId, { status: 'confirmed' });

        const projectId = (resource.project && (resource.project as any).id) || (resource as any).projectId || null;
        await this.jobService.create('ingest-content', JobPriority.NORMAL, {
            resourceId,
            projectId,
            content: workingContent || resource.content,
        });

        // Trigger relationship extraction if feature enabled
        const features = readFeaturesFromEnv();
        if (features.relationships && confirmed > 0) {
            try {
                const allEntities = await this.entityService.findByResourceId(resourceId);
                if (allEntities.length >= 2) {
                    // Fetch content explicitly (findOne excludes large text fields)
                    const relText = workingContent
                        || await this.resourceService.getWorkingContentById(resourceId)
                        || await this.resourceService.getContentById(resourceId)
                        || '';
                    await this.jobService.create('relationship-extraction', JobPriority.NORMAL, {
                        resourceId,
                        projectId,
                        text: relText,
                        entities: allEntities.map(e => ({
                            id: e.id,
                            name: e.name,
                            type: e.entityType?.name || 'UNKNOWN',
                        })),
                    });
                }
            } catch (error) {
                errors.push(`Failed to create relationship extraction job: ${error.message}`);
            }
        }

        return { confirmed, errors };
    }

    async confirmEntity(id: number): Promise<{ success: boolean; message?: string }> {
        try {
            // Find the pending entity
            const pending = await this.repository.findOne({
                where: { id },
                relations: ['entityType', 'resource']
            });

            if (!pending) {
                return { success: false, message: 'Pending entity not found' };
            }

            // Check if entity is already merged
            if (pending.status === 'merged') {
                return { success: false, message: 'Cannot confirm a merged entity' };
            }

            // Get all aliases from the entity
            const allAliases = pending.aliases || [];

            // Find or create the entity in the main entities table
            const entityTypeName = pending.entityType?.name;
            if (!entityTypeName) {
                return { success: false, message: 'Entity type is required' };
            }

            // Get resource to access project information
            const resource = await this.resourceService.findOne(pending.resourceId);
            if (!resource) {
                return { success: false, message: 'Resource not found' };
            }

            // Find existing entity or create new one
            let entity = await this.entityService.findByNameAndType(pending.name, pending.entityType.id);

            if (!entity) {
                // Create new entity with appropriate scope
                const createDto: any = {
                    name: pending.name,
                    entityTypeId: pending.entityType.id,
                    aliases: allAliases.length > 0 ? allAliases : undefined,
                };

                // Set global flag if scope is global
                if (pending.scope === 'global') {
                    createDto.global = true;
                }

                // Set projectIds if scope is project
                if (pending.scope === 'project' && resource.project) {
                    const projectId = typeof resource.project === 'object' ? resource.project.id : resource.project;
                    createDto.projectIds = [projectId];
                }

                entity = await this.entityService.create(createDto);
            } else {
                // Entity exists, update scope if needed
                if (pending.scope === 'global' && !entity.global) {
                    await this.entityService.update(entity.id, { global: true });
                    entity.global = true;
                }

                // If scope is project, ensure entity-project relation exists
                if (pending.scope === 'project' && resource.project) {
                    const projectId = typeof resource.project === 'object' ? resource.project.id : resource.project;
                    await this.entityService['addProjectToEntity'](entity.id, projectId);
                }
            }

            // Always link entity to resource (creates resource_entities relation)
            await this.resourceService.addEntityToResource(pending.resourceId, entity);

            let workingContent = resource.workingContent || '';
            let contentWasModified = false;

            // Replace document-scoped aliases in working_content
            if (allAliases.length > 0 && workingContent) {
                for (const alias of allAliases) {
                    if (alias.value !== pending.name && alias.scope === 'document') {
                        const pattern = new RegExp(`\\b${this.escapeRegExp(alias.value)}\\b`, 'gi');
                        const newContent = workingContent.replace(pattern, pending.name);
                        if (newContent !== workingContent) {
                            workingContent = newContent;
                            contentWasModified = true;
                        }
                    }
                }

                // Save updated working_content if it was modified
                if (contentWasModified) {
                    await this.resourceService.update(pending.resourceId, { workingContent });

                    // If resource language is not English, trigger new translation
                    if (resource.language && resource.language !== 'en') {
                        try {
                            await this.jobService.create('translate', JobPriority.NORMAL, {
                                translationType: 'content',
                                resourceId: pending.resourceId,
                                sourceLanguage: 'en',
                                targetLanguage: resource.language,
                                texts: [{ text: workingContent }],
                            });
                        } catch (error) {
                            // Log error but don't fail the confirmation
                            console.error('Failed to create translation job:', error);
                        }
                    }
                }
            }

            // Remove the pending entity from database
            await this.repository.remove(pending);

            return { success: true, message: 'Entity confirmed successfully' };
        } catch (error) {
            console.error('Failed to confirm entity:', error);
            return { success: false, message: `Failed to confirm entity: ${error.message}` };
        }
    }

    async mergeEntity(
        sourceId: number,
        targetType: 'pending' | 'confirmed',
        targetId: number,
        aliasScope: EntityScope
    ): Promise<{ success: boolean; message: string }> {
        try {
            // Get source pending entity
            const sourcePending = await this.repository.findOne({
                where: { id: sourceId },
                relations: ['entityType']
            });

            if (!sourcePending) {
                return { success: false, message: 'Source entity not found' };
            }

            // Create alias object from source entity
            const newAlias: EntityAlias = {
                locale: 'en', // Default locale
                value: sourcePending.name,
                scope: aliasScope
            };

            if (targetType === 'pending') {
                // Merge into pending entity (update target aliases)
                const targetPending = await this.repository.findOneBy({ id: targetId });
                if (!targetPending) {
                    return { success: false, message: 'Target pending entity not found' };
                }

                const currentAliases = targetPending.aliases || [];
                targetPending.aliases = [...currentAliases, newAlias];
                await this.repository.save(targetPending);

                // Mark source as merged (do not remove)
                sourcePending.status = 'merged';
                sourcePending.mergedTargetType = 'pending';
                sourcePending.mergedTargetId = targetId;
                sourcePending.mergedAt = new Date();
                const saved = await this.repository.save(sourcePending);

                // If alias scope is document, and we have a resource, replace occurrences in working_content
                // NOTE: For document-scoped aliases we replace occurrences of the alias text inside
                // the resource.working_content with the target entity name. This is a straightforward
                // regex-based, case-insensitive word-boundary replacement. It may not preserve
                // original casing in every position and does not attempt to parse HTML. This is
                // acceptable for the working_content which is normalized text used for entity extraction
                // and search highlighting.
                if (aliasScope === 'document' && sourcePending.resourceId) {
                    try {
                        const working = await this.resourceService.getWorkingContentById(sourcePending.resourceId);
                        if (working) {
                            // Replace full-word occurrences of the alias (case-insensitive)
                            const pattern = new RegExp(`\\b${this.escapeRegExp(sourcePending.name)}\\b`, 'gi');
                            const replaced = working.replace(pattern, targetPending.name || sourcePending.name);
                            if (replaced !== working) {
                                await this.resourceService.update(sourcePending.resourceId, { workingContent: replaced });
                            }
                        }
                    } catch (err) {
                        console.error('Failed to update working_content for document-scope alias merge (pending):', err);
                    }
                }

                return { success: true, message: 'Entity marked as merged into pending entity', pending: saved } as any;
            } else {
                // Merge into confirmed entity (update confirmed aliases)
                const confirmedEntity = await this.entityService.findOne(targetId);
                if (!confirmedEntity) {
                    return { success: false, message: 'Target confirmed entity not found' };
                }

                const currentAliases = confirmedEntity.aliases || [];
                const updatedAliases = [...currentAliases, newAlias];

                await this.entityService.update(targetId, {
                    aliases: updatedAliases
                });

                // Mark source as merged
                sourcePending.status = 'merged';
                sourcePending.mergedTargetType = 'confirmed';
                sourcePending.mergedTargetId = targetId;
                sourcePending.mergedAt = new Date();
                const saved = await this.repository.save(sourcePending);

                // If alias scope is document, update working_content replacing alias with confirmed entity name
                if (aliasScope === 'document' && sourcePending.resourceId) {
                    try {
                        const working = await this.resourceService.getWorkingContentById(sourcePending.resourceId);
                        if (working) {
                            const pattern = new RegExp(`\\b${this.escapeRegExp(sourcePending.name)}\\b`, 'gi');
                            const replaced = working.replace(pattern, confirmedEntity.name || sourcePending.name);
                            if (replaced !== working) {
                                await this.resourceService.update(sourcePending.resourceId, { workingContent: replaced });
                            }
                        }
                    } catch (err) {
                        console.error('Failed to update working_content for document-scope alias merge (confirmed):', err);
                    }
                }

                return { success: true, message: 'Entity marked as merged into confirmed entity', pending: saved } as any;
            }
        } catch (error) {
            console.error('Merge entity error:', error);
            return { success: false, message: `Failed to merge: ${error.message}` };
        }
    }

    async clearByResourceId(resourceId: number): Promise<void> {
        await this.repository.delete({ resourceId });
    }

    async cancelMerge(sourceId: number): Promise<{ success: boolean; message: string }> {
        try {
            const source = await this.repository.findOneBy({ id: sourceId });
            if (!source) return { success: false, message: 'Source pending entity not found' };
            if (source.status !== 'merged' || !source.mergedTargetType || !source.mergedTargetId) {
                return { success: false, message: 'Entity is not merged' };
            }

            // Build alias to remove
            const aliasToRemove: EntityAlias = {
                locale: 'en',
                value: source.name,
                scope: source.scope
            };

            if (source.mergedTargetType === 'pending') {
                const target = await this.repository.findOneBy({ id: source.mergedTargetId });
                if (target && target.aliases) {
                    target.aliases = (target.aliases || []).filter(a => !(a.value === aliasToRemove.value && a.scope === aliasToRemove.scope));
                    await this.repository.save(target);
                }
            } else if (source.mergedTargetType === 'confirmed') {
                const confirmed = await this.entityService.findOne(source.mergedTargetId!);
                if (confirmed && confirmed.aliases) {
                    // Confirmed entity alias shape may not include scope; remove by value match
                    const filtered = (confirmed.aliases || []).filter(a => a.value !== aliasToRemove.value);
                    await this.entityService.update(confirmed.id, { aliases: filtered });
                }
            }

            // Reset source merge fields
            source.status = 'pending';
            source.mergedTargetType = null;
            source.mergedTargetId = null;
            source.mergedAt = null;
            await this.repository.save(source);

            return { success: true, message: 'Merge cancelled successfully' };
        } catch (error) {
            console.error('Cancel merge error:', error);
            return { success: false, message: `Failed to cancel merge: ${error.message}` };
        }
    }

    /**
     * Update translations for a specific pending entity
     */
    async updateTranslations(id: number, translations: EntityTranslation): Promise<PendingEntityEntity | null> {
        const entity = await this.repository.findOneBy({ id });
        if (!entity) return null;

        entity.translations = { ...entity.translations, ...translations };
        return await this.repository.save(entity);
    }

    /**
     * Batch update translations for multiple pending entities
     */
    async batchUpdateTranslations(updates: Array<{ id: number; translations: EntityTranslation }>): Promise<void> {
        for (const update of updates) {
            await this.updateTranslations(update.id, update.translations);
        }
    }

    /**
     * Retranslate entity when name changes
     * Updates the translation for the current language and triggers jobs for missing translations
     */
    async retranslateEntity(
        id: number,
        newName: string,
        currentLanguage: string,
        resourceLanguage: string,
        targetLanguage: string
    ): Promise<{ success: boolean; message?: string }> {
        try {
            const pending = await this.repository.findOne({
                where: { id },
                relations: ['entityType']
            });

            if (!pending) {
                return { success: false, message: 'Pending entity not found' };
            }

            // Update translations object
            const updatedTranslations = { ...(pending.translations || {}) };

            // Update the current language translation with the new name
            if (currentLanguage !== 'en') {
                updatedTranslations[currentLanguage] = newName;
            }

            // Save updated translations
            pending.translations = updatedTranslations;
            await this.repository.save(pending);

            // Determine which languages need translation
            const languagesToTranslate: string[] = [];

            if (resourceLanguage !== 'en' && !updatedTranslations[resourceLanguage]) {
                languagesToTranslate.push(resourceLanguage);
            }

            if (targetLanguage !== 'en' && targetLanguage !== resourceLanguage && !updatedTranslations[targetLanguage]) {
                languagesToTranslate.push(targetLanguage);
            }

            // If there are languages to translate, create a translation job
            if (languagesToTranslate.length > 0) {
                const translationPayload = {
                    resourceId: pending.resourceId,
                    texts: [{ text: pending.name }],
                    sourceLanguage: 'en',
                    targetLanguages: languagesToTranslate,
                    translationType: 'entity-retranslate',
                    entityId: pending.id,
                };

                await this.jobService.create(
                    'translate',
                    JobPriority.NORMAL,
                    translationPayload
                );
            }

            return { success: true };
        } catch (error) {
            console.error('Failed to retranslate entity:', error);
            return { success: false, message: `Failed to retranslate: ${error.message}` };
        }
    }
}
