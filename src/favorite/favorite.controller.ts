import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { FavoriteService } from './favorite.service';
import { FavoriteEntity } from './favorite.entity';
import { CreateFavoriteDto, UpdateFavoriteDto } from './dto/favorite.dto';

@Controller('favorites')
export class FavoriteController {
  constructor(private readonly favoriteService: FavoriteService) { }

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<FavoriteEntity[]> {
    return await this.favoriteService.findByProject(projectId);
  }

  @Delete('project/:projectId')
  async removeByUrl(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('url') url: string,
  ) {
    return await this.favoriteService.removeByUrl(projectId, url ?? '');
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<FavoriteEntity | null> {
    return await this.favoriteService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateFavoriteDto): Promise<FavoriteEntity> {
    return await this.favoriteService.upsert(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFavoriteDto,
  ): Promise<FavoriteEntity | null> {
    return await this.favoriteService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.favoriteService.remove(id);
  }
}
