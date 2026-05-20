import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppStateService } from '../../../src/app-state/app-state.service';
import { AppStateEntity } from '../../../src/app-state/app-state.entity';

describe('AppStateService', () => {
  let service: AppStateService;
  let repo: { findOne: jest.Mock; upsert: jest.Mock };

  beforeEach(async () => {
    repo = { findOne: jest.fn(), upsert: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppStateService,
        { provide: getRepositoryToken(AppStateEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(AppStateService);
  });

  it('get returns decoded value when row exists', async () => {
    repo.findOne.mockResolvedValue({ key: 'k', value: '42' });
    expect(await service.get('k', (v) => Number(v))).toBe(42);
  });

  it('get returns null when row absent', async () => {
    repo.findOne.mockResolvedValue(null);
    expect(await service.get('k', (v) => Number(v))).toBeNull();
  });

  it('get returns null when row.value is null', async () => {
    repo.findOne.mockResolvedValue({ key: 'k', value: null });
    expect(await service.get('k', (v) => Number(v))).toBeNull();
  });

  it('set upserts encoded value', async () => {
    await service.set('k', 7, (v) => String(v));
    expect(repo.upsert).toHaveBeenCalledWith({ key: 'k', value: '7' }, ['key']);
  });

  it('getTimestamp returns Date when set previously', async () => {
    const iso = '2026-05-18T10:00:00.000Z';
    repo.findOne.mockResolvedValue({ key: 'k', value: iso });
    const got = await service.getTimestamp('k');
    expect(got).toBeInstanceOf(Date);
    expect(got!.toISOString()).toBe(iso);
  });

  it('setTimestamp serializes to ISO', async () => {
    const d = new Date('2026-05-18T10:00:00.000Z');
    await service.setTimestamp('k', d);
    expect(repo.upsert).toHaveBeenCalledWith(
      { key: 'k', value: '2026-05-18T10:00:00.000Z' },
      ['key'],
    );
  });

  it('getTimestamp returns null when missing', async () => {
    repo.findOne.mockResolvedValue(null);
    expect(await service.getTimestamp('missing')).toBeNull();
  });
});
