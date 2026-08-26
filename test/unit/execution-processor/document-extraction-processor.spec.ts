// Jest does not resolve the src alias used by production builds.
// eslint-disable-next-line max-len
import { DocumentExtractionProcessor } from '../../../src/execution-processor/processors/document-extraction-processor';
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('DocumentExtractionProcessor', () => {
  it('creates media transcription as a child inference with an artifact', async () => {
    const resourceService = { update: jest.fn().mockResolvedValue(undefined) };
    const executionService = {
      createInference: jest.fn().mockResolvedValue({ executionId: 'child' }),
    };
    const fileStorageService = {
      getRelativePath: jest.fn().mockReturnValue('media/source.wav'),
      getFile: jest.fn().mockResolvedValue(Buffer.from('wave')),
    };
    const processor = new DocumentExtractionProcessor(
      resourceService as any,
      executionService as any,
      fileStorageService as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      rootExecutionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca700',
      ownerPrincipal: 'user-1',
      payload: { hash: 'hash', extension: '.wav', resourceId: 7 },
      result: {
        title: 'Recording',
        author: null,
        publication_date: null,
        content: '<p>Audio</p>',
      },
    } as ExecutionEntity;

    await processor.process(execution);

    expect(executionService.createInference).toHaveBeenCalledWith(
      'transcribe',
      expect.any(String),
      { hash: 'hash', extension: '.wav', resourceId: 7 },
      {
        rootExecutionId: execution.rootExecutionId,
        parentExecutionId: execution.executionId,
        ownerPrincipal: execution.ownerPrincipal,
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
