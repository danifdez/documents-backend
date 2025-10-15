import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthorEntity } from './author.entity';

@Injectable()
export class AuthorService {
    constructor(
        @InjectRepository(AuthorEntity)
        private readonly repo: Repository<AuthorEntity>,
    ) { }

    async findOne(id: number): Promise<AuthorEntity | null> {
        try {
            return await this.repo.findOne({ where: { id } });
        } catch (error) {
            throw error;
        }
    }

    async findByName(name: string): Promise<AuthorEntity | null> {
        try {
            const authors = await this.repo
                .createQueryBuilder('author')
                .where('LOWER(author.name) = LOWER(:name)', { name })
                .getMany();

            return authors.length > 0 ? authors[0] : null;
        } catch (error) {
            throw error;
        }
    }

    async findAll(): Promise<AuthorEntity[]> {
        try {
            return await this.repo.find();
        } catch (error) {
            throw error;
        }
    }

    async create(author: Partial<AuthorEntity>): Promise<AuthorEntity> {
        try {
            const created = this.repo.create(author);
            return await this.repo.save(created);
        } catch (error) {
            throw error;
        }
    }

    async findOrCreate(name: string): Promise<AuthorEntity> {
        try {
            const normalizedName = name.trim();

            if (!normalizedName) {
                throw new Error('Author name cannot be empty');
            }

            const existing = await this.findByName(normalizedName);
            if (existing) {
                return existing;
            }

            return await this.create({ name: normalizedName });
        } catch (error) {
            throw error;
        }
    }

    async update(id: number, author: Partial<AuthorEntity>): Promise<AuthorEntity | null> {
        try {
            const existing = await this.repo.preload({ id, ...author });
            if (!existing) return null;
            return await this.repo.save(existing);
        } catch (error) {
            throw error;
        }
    }

    async remove(id: number): Promise<AuthorEntity | null> {
        try {
            const author = await this.repo.findOneBy({ id });
            if (!author) return null;
            await this.repo.remove(author);
            return author;
        } catch (error) {
            throw error;
        }
    }
}
