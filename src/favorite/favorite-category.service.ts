import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FavoriteCategoryEntity } from './favorite-category.entity';
import {
  CreateFavoriteCategoryDto,
  UpdateFavoriteCategoryDto,
} from './dto/favorite-category.dto';

@Injectable()
export class FavoriteCategoryService {
  constructor(
    @InjectRepository(FavoriteCategoryEntity)
    private readonly repository: Repository<FavoriteCategoryEntity>,
  ) {}

  async findByProject(projectId: number): Promise<FavoriteCategoryEntity[]> {
    return await this.repository.find({
      where: { project: { id: projectId } },
      order: { name: 'ASC' },
    });
  }

  private async findSibling(
    projectId: number,
    parentId: number | null,
    name: string,
    excludeId?: number,
  ): Promise<FavoriteCategoryEntity | null> {
    const query = this.repository
      .createQueryBuilder('category')
      .where('category.projectId = :projectId', { projectId })
      .andWhere('LOWER(category.name) = LOWER(:name)', { name });

    if (parentId === null) {
      query.andWhere('category.parentId IS NULL');
    } else {
      query.andWhere('category.parentId = :parentId', { parentId });
    }
    if (excludeId !== undefined) {
      query.andWhere('category.id != :excludeId', { excludeId });
    }
    return await query.getOne();
  }

  private async resolveParent(
    projectId: number,
    parentId: number | null | undefined,
    selfId?: number,
  ): Promise<FavoriteCategoryEntity | null> {
    if (parentId === undefined || parentId === null) return null;

    const parent = await this.repository.findOne({
      where: { id: parentId, project: { id: projectId } },
    });
    if (!parent) {
      throw new BadRequestException(
        'Parent category does not belong to this project',
      );
    }

    if (selfId !== undefined) {
      let currentId: number | null = parent.id;
      while (currentId != null) {
        if (currentId === selfId) {
          throw new BadRequestException(
            'A category cannot be nested inside itself',
          );
        }
        const node = await this.repository.findOneBy({ id: currentId });
        currentId = node?.parentId ?? null;
      }
    }

    return parent;
  }

  async create(
    dto: CreateFavoriteCategoryDto,
  ): Promise<FavoriteCategoryEntity> {
    const parent = await this.resolveParent(dto.projectId, dto.parentId);
    const duplicate = await this.findSibling(
      dto.projectId,
      parent?.id ?? null,
      dto.name,
    );
    if (duplicate) {
      throw new BadRequestException(
        'A category with that name already exists here',
      );
    }

    const created = this.repository.create({
      project: { id: dto.projectId } as any,
      parent,
      name: dto.name,
    });
    return await this.repository.save(created);
  }

  async update(
    id: number,
    dto: UpdateFavoriteCategoryDto,
  ): Promise<FavoriteCategoryEntity | null> {
    const category = await this.repository.findOne({
      where: { id },
      relations: ['project', 'parent'],
    });
    if (!category) return null;

    let parent = category.parent;
    if (dto.parentId !== undefined) {
      parent = await this.resolveParent(category.project.id, dto.parentId, id);
    }

    const name = dto.name ?? category.name;
    const duplicate = await this.findSibling(
      category.project.id,
      parent?.id ?? null,
      name,
      id,
    );
    if (duplicate) {
      throw new BadRequestException(
        'A category with that name already exists here',
      );
    }

    category.name = name;
    category.parent = parent;
    return await this.repository.save(category);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const category = await this.repository.findOneBy({ id });
    if (!category) return { deleted: false };
    await this.repository.remove(category);
    return { deleted: true };
  }
}
