import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthorEntity } from './author.entity';
import { BaseCrudService } from '../common/base-crud.service';

@Injectable()
export class AuthorService extends BaseCrudService<AuthorEntity> {
    constructor(
        @InjectRepository(AuthorEntity)
        repo: Repository<AuthorEntity>,
    ) {
        super(repo);
    }

    async findByName(name: string): Promise<AuthorEntity | null> {
        const authors = await this.repository
            .createQueryBuilder('author')
            .where('LOWER(author.name) = LOWER(:name)', { name })
            .getMany();

        return authors.length > 0 ? authors[0] : null;
    }

    async findOrCreate(name: string): Promise<AuthorEntity> {
        const normalizedName = name.trim();

        if (!normalizedName) {
            throw new BadRequestException('Author name cannot be empty');
        }

        const existing = await this.findByName(normalizedName);
        if (existing) {
            return existing;
        }

        return await this.create({ name: normalizedName });
    }
}
