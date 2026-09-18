import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FavoriteEntity } from './favorite.entity';
import { FavoriteCategoryEntity } from './favorite-category.entity';
import { CreateFavoriteDto, UpdateFavoriteDto } from './dto/favorite.dto';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(FavoriteEntity)
    private readonly repository: Repository<FavoriteEntity>,
    @InjectRepository(FavoriteCategoryEntity)
    private readonly categoryRepository: Repository<FavoriteCategoryEntity>,
  ) {}

  async findByProject(projectId: number): Promise<FavoriteEntity[]> {
    return await this.repository.find({
      where: { project: { id: projectId } },
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<FavoriteEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['category'],
    });
  }

  private async resolveCategory(
    projectId: number,
    categoryId: number | null | undefined,
  ): Promise<FavoriteCategoryEntity | null> {
    if (categoryId === undefined || categoryId === null) return null;
    const category = await this.categoryRepository.findOne({
      where: { id: categoryId, project: { id: projectId } },
    });
    if (!category) {
      throw new BadRequestException('Category does not belong to this project');
    }
    return category;
  }

  async upsert(dto: CreateFavoriteDto): Promise<FavoriteEntity> {
    const existing = await this.repository.findOne({
      where: { project: { id: dto.projectId }, url: dto.url },
    });

    const category = await this.resolveCategory(dto.projectId, dto.categoryId);

    if (existing) {
      let changed = false;
      if (dto.title !== undefined && dto.title !== existing.title) {
        existing.title = dto.title;
        changed = true;
      }
      if (dto.categoryId !== undefined) {
        existing.category = category;
        changed = true;
      }
      if (changed) return await this.repository.save(existing);
      return existing;
    }

    const created = this.repository.create({
      project: { id: dto.projectId } as any,
      url: dto.url,
      title: dto.title ?? '',
      category,
    });
    return await this.repository.save(created);
  }

  async update(
    id: number,
    dto: UpdateFavoriteDto,
  ): Promise<FavoriteEntity | null> {
    const favorite = await this.repository.findOne({
      where: { id },
      relations: ['category', 'project'],
    });
    if (!favorite) return null;

    if (dto.url !== undefined && dto.url !== favorite.url) {
      const clash = await this.repository.findOne({
        where: { project: { id: favorite.project.id }, url: dto.url },
      });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Another favorite already uses that URL');
      }
      favorite.url = dto.url;
    }

    if (dto.title !== undefined) favorite.title = dto.title;
    if (dto.categoryId !== undefined) {
      favorite.category = await this.resolveCategory(
        favorite.project.id,
        dto.categoryId,
      );
    }
    return await this.repository.save(favorite);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const favorite = await this.repository.findOneBy({ id });
    if (!favorite) return { deleted: false };
    await this.repository.remove(favorite);
    return { deleted: true };
  }

  async removeByUrl(
    projectId: number,
    url: string,
  ): Promise<{ deleted: boolean }> {
    const favorite = await this.repository.findOne({
      where: { project: { id: projectId }, url },
    });
    if (!favorite) return { deleted: false };
    await this.repository.remove(favorite);
    return { deleted: true };
  }
}
