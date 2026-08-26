// Jest does not resolve the src alias used by production builds.
// eslint-disable-next-line max-len
import { DocumentExtractionProcessor } from '../../../src/execution-processor/processors/document-extraction-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';
import { ResourceEntity } from '../../../src/resource/resource.entity';

describe('DocumentExtractionProcessor', () => {
  it('creates media transcription as a child inference with an artifact', async () => {
    const resource = {
      id: 7,
      hash: 'hash',
      title: null,
      publicationDate: null,
      content: null,
      pages: null,
      status: 'extracting',
    };
    const transactionalRepository = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn().mockResolvedValue(resource),
      findOneBy: jest.fn().mockImplementation(async () => resource),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(ResourceEntity);
        return transactionalRepository;
      }),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 5, name: 'Ada' }]),
    };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const executionService = {
      createInference: jest.fn().mockResolvedValue({ executionId: 'child' }),
    };
    const fileStorageService = {
      getRelativePath: jest.fn().mockReturnValue('media/source.wav'),
      getFile: jest.fn().mockResolvedValue(Buffer.from('wave')),
    };
    const processor = new DocumentExtractionProcessor(
      executionService as any,
      fileStorageService as any,
      effectJournal as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      rootExecutionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca700',
      ownerPrincipal: 'user-1',
      payload: { hash: 'hash', extension: '.wav', resourceId: 7 },
      result: {
        title: 'Recording',
        author: 'Ada',
        publication_date: null,
        content: '<p>Audio</p>',
      },
    } as ExecutionEntity;

    await processor.process(execution);

    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'document-extraction:7',
        effectType: 'resource_extraction_replace',
      }),
      expect.any(Function),
    );
    expect(resource).toEqual(
      expect.objectContaining({
        title: 'Recording',
        content: '<p>Audio</p>',
        status: 'transcribing',
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO resource_authors'),
      [7, 5],
    );

    expect(executionService.createInference).toHaveBeenCalledWith(
      'transcribe',
      expect.any(String),
      { hash: 'hash', extension: '.wav', resourceId: 7 },
      {
        rootExecutionId: execution.rootExecutionId,
        parentExecutionId: execution.executionId,
        ownerPrincipal: execution.ownerPrincipal,
        childIdempotencyKey: 'document-extraction:transcribe:7:hash',
        inputArtifacts: [
          {
            role: 'media',
            kind: 'source_media',
            mediaType: 'application/octet-stream',
            body: Buffer.from('wave'),
          },
        ],
      },
    );
  });
});
