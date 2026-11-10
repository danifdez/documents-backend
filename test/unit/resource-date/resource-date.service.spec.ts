import { ResourceDateService } from '../../../src/resource-date/resource-date.service';
import { ResourceDateController } from '../../../src/resource-date/resource-date.controller';
import { ResourceDateEntity } from '../../../src/resource-date/resource-date.entity';
import { createMockRepository, MockRepository } from '../../test-utils';

describe('ResourceDateService', () => {
  let service: ResourceDateService;
  let repo: MockRepository<ResourceDateEntity>;

  beforeEach(() => {
    repo = createMockRepository<ResourceDateEntity>();
    service = new ResourceDateService(repo as any);
  });

  it('deletes a date scoped by resource and id', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });

    await expect(service.remove(7, 3)).resolves.toBe(true);
    expect(repo.delete).toHaveBeenCalledWith({ id: 3, resourceId: 7 });
  });

  it('returns false when the date does not belong to the resource', async () => {
    repo.delete.mockResolvedValue({ affected: 0 });

    await expect(service.remove(7, 3)).resolves.toBe(false);
  });
});

describe('ResourceDateController', () => {
  it('passes both route ids to the service', async () => {
    const service = { remove: jest.fn().mockResolvedValue(true) };
    const controller = new ResourceDateController(service as any);

    await expect(controller.remove(7, 3)).resolves.toEqual({ deleted: true });
    expect(service.remove).toHaveBeenCalledWith(7, 3);
  });
});
