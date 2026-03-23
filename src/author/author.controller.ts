import { Controller, Get, Post, Body, Param, Delete, Patch, ParseIntPipe, Query } from '@nestjs/common';
import { AuthorService } from './author.service';
import { AuthorEntity } from './author.entity';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('authors')
export class AuthorController {
    constructor(private readonly authorService: AuthorService) { }

    @Get()
    async findAll(@Query('name') name?: string): Promise<AuthorEntity[]> {
        if (name) {
            const author = await this.authorService.findByName(name.trim());
            return author ? [author] : [];
        }
        return await this.authorService.findAll();
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number): Promise<AuthorEntity | null> {
        return await this.authorService.findOne(id);
    }

    @Post()
    @RequirePermissions(Permission.WRITE)
    async create(@Body() author: Partial<AuthorEntity>): Promise<AuthorEntity> {
        if (author.name) {
            return await this.authorService.findOrCreate(author.name);
        }
        return await this.authorService.create(author);
    }

    @Patch(':id')
    @RequirePermissions(Permission.WRITE)
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() author: Partial<AuthorEntity>,
    ): Promise<AuthorEntity | null> {
        return await this.authorService.update(id, author);
    }

    @Delete(':id')
    @RequirePermissions(Permission.DELETE)
    async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.authorService.remove(id);
    }
}
