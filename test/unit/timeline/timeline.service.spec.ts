import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TimelineService } from '../../../src/timeline/timeline.service';
import { TimelineEntity } from '../../../src/timeline/timeline.entity';
import { createMockRepository, MockRepository } from '../../test-utils';
import { buildTimeline } from '../../factories';

describe('TimelineService', () => {
  let service: TimelineService;
  let repo: MockRepository<TimelineEntity>;

  beforeEach(async () => {
    repo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimelineService,
        { provide: getRepositoryToken(TimelineEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(TimelineService);
  });

  describe('appendEvent', () => {
    it('appends an event with a generated id and defaults', async () => {
      const timeline = buildTimeline({ timelineData: null });
      repo.findOne.mockResolvedValue(timeline);
      repo.save.mockImplementation(async (t: TimelineEntity) => t);

      const result = await service.appendEvent(1, {
        title: 'Evento',
        date: '2024-04-03',
      });

      expect(result).not.toBeNull();
      expect(result!.timelineId).toBe(1);
      expect(result!.event.title).toBe('Evento');
      expect(result!.event.date).toBe('2024-04-03');
      expect(result!.event.color).toBe('#3b82f6');
      expect(typeof result!.event.id).toBe('string');
      expect(result!.event.id.length).toBeGreaterThan(0);
      expect(timeline.timelineData).toHaveLength(1);
    });

    it('keeps existing events', async () => {
      const existing = buildTimeline({
        timelineData: [
          { id: 'a', title: 'Uno', date: '2020-01-01', color: '#000000' },
        ],
      });
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockImplementation(async (t: TimelineEntity) => t);

      await service.appendEvent(1, { title: 'Dos', date: '2020-02-02' });

      expect(existing.timelineData).toHaveLength(2);
      expect(existing.timelineData![0].title).toBe('Uno');
      expect(existing.timelineData![1].title).toBe('Dos');
    });

    it('passes through optional fields', async () => {
      const timeline = buildTimeline({ timelineData: [] });
      repo.findOne.mockResolvedValue(timeline);
      repo.save.mockImplementation(async (t: TimelineEntity) => t);

      const result = await service.appendEvent(1, {
        title: 'Evento',
        date: '2024-04-03',
        endDate: '2024-04-05',
        description: 'Fuente: https://example.com',
        color: '#ff0000',
        docId: 7,
        resourceId: 9,
      });

      expect(result!.event.endDate).toBe('2024-04-05');
      expect(result!.event.description).toBe('Fuente: https://example.com');
      expect(result!.event.color).toBe('#ff0000');
      expect(result!.event.docId).toBe(7);
      expect(result!.event.resourceId).toBe(9);
    });

    it('returns null when the timeline does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(
        await service.appendEvent(999, { title: 'X', date: '2024-01-01' }),
      ).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
