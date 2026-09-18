import { Module } from '@nestjs/common';
import { FavoriteController } from './favorite.controller';
import { FavoriteCategoryController } from './favorite-category.controller';
import { FavoriteService } from './favorite.service';
import { FavoriteCategoryService } from './favorite-category.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [FavoriteController, FavoriteCategoryController],
  providers: [FavoriteService, FavoriteCategoryService],
  exports: [FavoriteService, FavoriteCategoryService],
})
export class FavoriteModule {}
