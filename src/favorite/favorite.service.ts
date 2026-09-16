import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FavoriteEntity } from './favorite.entity';
import { CreateFavoriteDto, UpdateFavoriteDto } from './dto/favorite.dto';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(FavoriteEntity)
    private readonly repository: Repository<FavoriteEntity>,
  ) { }

  async findByProject(projectId: number): Promise<FavoriteEntity[]> {
    return await this.repository.find({
      where: { project: { id: projectId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<FavoriteEntity | null> {
    return await this.repository.findOneBy({ id });
  }

  // Idempotente por (proyecto, url): marcar la misma página dos veces no crea
  // dos filas. Si ya estaba y llega un título distinto, se actualiza; si no,
  // se devuelve la que hay.
  async upsert(dto: CreateFavoriteDto): Promise<FavoriteEntity> {
    const existing = await this.repository.findOne({
      where: { project: { id: dto.projectId }, url: dto.url },
    });
    if (existing) {
      if (dto.title !== undefined && dto.title !== existing.title) {
        existing.title = dto.title;
        return await this.repository.save(existing);
      }
      return existing;
    }

    const created = this.repository.create({
      project: { id: dto.projectId } as any,
      url: dto.url,
      title: dto.title ?? '',
    });
    return await this.repository.save(created);
  }

  async update(
    id: number,
    dto: UpdateFavoriteDto,
  ): Promise<FavoriteEntity | null> {
    const favorite = await this.repository.findOneBy({ id });
    if (!favorite) return null;
    if (dto.title !== undefined) favorite.title = dto.title;
    return await this.repository.save(favorite);
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const favorite = await this.repository.findOneBy({ id });
    if (!favorite) return { deleted: false };
    await this.repository.remove(favorite);
    return { deleted: true };
  }

  // Borrado por (proyecto, url): el navegador conoce la dirección que marcó,
  // no el identificador de la fila, así que puede quitar el favorito sin
  // haberse traído antes la lista.
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
