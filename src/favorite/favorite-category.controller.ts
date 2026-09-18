import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
} from '@nestjs/common';
import { FavoriteCategoryService } from './favorite-category.service';
import { FavoriteCategoryEntity } from './favorite-category.entity';
import {
  CreateFavoriteCategoryDto,
  UpdateFavoriteCategoryDto,
} from './dto/favorite-category.dto';

@Controller('favorite-categories')
export class FavoriteCategoryController {
  constructor(
    private readonly favoriteCategoryService: FavoriteCategoryService,
  ) {}

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<FavoriteCategoryEntity[]> {
    return await this.favoriteCategoryService.findByProject(projectId);
  }

  @Post()
  async create(
    @Body() dto: CreateFavoriteCategoryDto,
  ): Promise<FavoriteCategoryEntity> {
    return await this.favoriteCategoryService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFavoriteCategoryDto,
  ): Promise<FavoriteCategoryEntity | null> {
    return await this.favoriteCategoryService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.favoriteCategoryService.remove(id);
  }
}
