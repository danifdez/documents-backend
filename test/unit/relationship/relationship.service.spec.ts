import { RelationshipService } from '../../../src/relationship/relationship.service';

describe('RelationshipService', () => {
  let executionService: { create: jest.Mock };
  let resourceService: {
    findOne: jest.Mock;
    findByProject: jest.Mock;
    getContentById: jest.Mock;
  };
  let entityService: { findOne: jest.Mock; findByResourceId: jest.Mock };
  let graphService: {
    queryByResource: jest.Mock;
    createRelationship: jest.Mock;
  };
  let service: RelationshipService;

  beforeEach(() => {
    executionService = { create: jest.fn() };
    resourceService = {
      findOne: jest.fn(),
      findByProject: jest.fn(),
      getContentById: jest.fn(),
    };
    entityService = { findOne: jest.fn(), findByResourceId: jest.fn() };
    graphService = {
      queryByResource: jest.fn(),
      createRelationship: jest.fn(),
    };
    service = new RelationshipService(
      executionService as any,
      resourceService as any,
      entityService as any,
      graphService as any,
    );
  });

  it('queries AGE directly without creating a Models execution', async () => {
    const graph = { entities: [], relationships: [] };
    graphService.queryByResource.mockResolvedValue(graph);

    await expect(service.queryByResource(7)).resolves.toEqual(graph);
    expect(graphService.queryByResource).toHaveBeenCalledWith(7);
    expect(executionService.create).not.toHaveBeenCalled();
  });

  it('derives graph scope from the resource instead of accepting projectId', async () => {
    entityService.findOne
      .mockResolvedValueOnce({
        id: 1,
        name: 'Ada',
        entityType: { name: 'PERSON' },
      })
      .mockResolvedValueOnce({
        id: 2,
        name: 'Engine',
        entityType: { name: 'PRODUCT' },
      });
    resourceService.findOne.mockResolvedValue({ project: { id: 3 } });
    graphService.createRelationship.mockResolvedValue(undefined);

    await expect(
      service.createRelationship({
        subjectId: 1,
        predicate: 'documented',
        objectId: 2,
        resourceId: 7,
      }),
    ).resolves.toEqual({ success: true });
    expect(graphService.createRelationship).toHaveBeenCalledWith(
      { id: 1, name: 'Ada', type: 'PERSON' },
      'documented',
      { id: 2, name: 'Engine', type: 'PRODUCT' },
      7,
      3,
    );
  });
});
