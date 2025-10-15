import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorEntity } from './author.entity';
import { AuthorService } from './author.service';
import { AuthorController } from './author.controller';

@Module({
    imports: [TypeOrmModule.forFeature([AuthorEntity])],
    controllers: [AuthorController],
    providers: [AuthorService],
    exports: [AuthorService],
})
export class AuthorModule { }
