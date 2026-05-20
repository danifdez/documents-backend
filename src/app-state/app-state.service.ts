import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppStateEntity } from './app-state.entity';

@Injectable()
export class AppStateService {
  constructor(
    @InjectRepository(AppStateEntity)
    private readonly repository: Repository<AppStateEntity>,
  ) { }

  async get<T>(key: string, decode: (raw: string) => T): Promise<T | null> {
    const row = await this.repository.findOne({ where: { key } });
    if (!row || row.value === null) return null;
    return decode(row.value);
  }

  async set<T>(key: string, value: T, encode: (v: T) => string): Promise<void> {
    await this.repository.upsert(
      { key, value: encode(value) },
      ['key'],
    );
  }

  async getTimestamp(key: string): Promise<Date | null> {
    return this.get(key, (raw) => new Date(raw));
  }

  async setTimestamp(key: string, date: Date): Promise<void> {
    await this.set(key, date, (d) => d.toISOString());
  }
}
