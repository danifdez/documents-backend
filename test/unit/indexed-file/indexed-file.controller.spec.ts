import {
  BadRequestException,
  ConflictException,
  HttpStatus,
} from '@nestjs/common';
import {
  AgentIndexedFileController,
  AssistantIndexedFileController,
} from '../../../src/indexed-file/indexed-file.controller';

describe.each([
  { ownerType: 'agent', Controller: AgentIndexedFileController },
  { ownerType: 'assistant', Controller: AssistantIndexedFileController },
])('Indexed files for an $ownerType', ({ ownerType, Controller }) => {
  const owner = { ownerType, ownerId: 7 };
  const mtime = new Date('2026-01-01T00:00:00Z');
  const file = {
    id: 10,
    filename: 'notes.txt',
    size: '12',
    mimeType: 'text/plain',
    checksum: 'test',
    embeddingId: null,
    mtime,
    extractedText: null,
    internal: 'private',
  };
  const dto = {
    id: 10,
    filename: 'notes.txt',
    size: 12,
    mimeType: 'text/plain',
    checksum: 'test',
    isIndexed: false,
    mtime,
    hasExtractedText: null,
  };
  let service: Record<string, jest.Mock>;
  let controller: AgentIndexedFileController | AssistantIndexedFileController;

  beforeEach(() => {
    service = Object.fromEntries(
      [
        'findByOwner',
        'writeFile',
        'hasFolderConfigured',
        'search',
        'readWithSync',
        'deleteFile',
        'scanFolder',
      ].map((name) => [name, jest.fn()]),
    );
    service.writeFile.mockResolvedValue(file);
    controller = new Controller(service as any);
  });

  it('reconciles and removes files in scope and returns public metadata', async () => {
    service.findByOwner.mockResolvedValue([
      file,
      {
        ...file,
        id: 11,
        size: 5,
        embeddingId: 'vector-id',
        extractedText: 'some text',
      },
      { ...file, id: 12, extractedText: '' },
    ]);
    const result = await controller.list(7);
    expect(result).toMatchObject([
      dto,
      { id: 11, size: 5, isIndexed: true, hasExtractedText: true },
      { id: 12, isIndexed: false, hasExtractedText: false },
    ]);
    expect(result[0]).not.toHaveProperty('internal');
    expect(service.findByOwner).toHaveBeenCalledWith(owner);
    service.scanFolder.mockResolvedValue({ added: 1 });
    await expect(controller.reconcile(7)).resolves.toEqual({ added: 1 });
    expect(service.scanFolder).toHaveBeenCalledWith(owner);
    await expect(controller.remove(7, 10)).resolves.toEqual({ deleted: true });
    expect(service.deleteFile).toHaveBeenCalledWith(10, owner);
  });

  it('writes exactly one representation and only overwrites when requested', async () => {
    const filename = 'notes.txt';
    await expect(controller.write(7, { filename })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.write(7, {
        filename,
        content: 'text',
        contentBase64: 'dGV4dA==',
      }),
    ).rejects.toMatchObject({ response: { error: 'ambiguous_content' } });
    expect(service.writeFile).not.toHaveBeenCalled();
    await expect(
      controller.write(7, { filename, content: '', overwrite: true }),
    ).resolves.toMatchObject(dto);
    await expect(
      controller.write(7, { filename, contentBase64: 'dGV4dA==' }),
    ).resolves.toMatchObject(dto);
    expect(service.writeFile.mock.calls).toEqual([
      [owner, filename, '', { overwrite: true }],
      [owner, filename, Buffer.from('text'), { overwrite: false }],
    ]);
    service.writeFile.mockRejectedValueOnce(
      new ConflictException('already_exists'),
    );
    await expect(
      controller.write(7, { filename, content: 'text' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'already_exists', filename },
    });
    const error = new Error('write failed');
    service.writeFile.mockRejectedValueOnce(error);
    await expect(
      controller.write(7, { filename, content: 'text' }),
    ).rejects.toBe(error);
  });

  it('uses the uploaded name or trimmed override and never overwrites during upload', async () => {
    const buffer = Buffer.from('notes');
    const upload = { originalname: 'local.txt', buffer } as Express.Multer.File;
    await expect(controller.upload(7, null)).rejects.toMatchObject({
      response: { error: 'missing_file' },
    });
    await expect(
      controller.upload(7, { ...upload, originalname: '' }),
    ).rejects.toMatchObject({ response: { error: 'missing_filename' } });
    await expect(controller.upload(7, upload, '   ')).resolves.toMatchObject(
      dto,
    );
    await expect(
      controller.upload(7, upload, '  notes.txt  '),
    ).resolves.toMatchObject(dto);
    expect(service.writeFile.mock.calls).toEqual([
      [owner, 'local.txt', buffer, { overwrite: false }],
      [owner, 'notes.txt', buffer, { overwrite: false }],
    ]);
    service.writeFile.mockRejectedValueOnce(
      new ConflictException('already_exists'),
    );
    await expect(controller.upload(7, upload)).rejects.toMatchObject({
      status: 409,
      response: { error: 'already_exists', filename: 'local.txt' },
    });
    const error = new Error('upload failed');
    service.writeFile.mockRejectedValueOnce(error);
    await expect(controller.upload(7, upload)).rejects.toBe(error);
  });

  it('checks the owner folder, trims search terms and bounds the result count', async () => {
    await expect(controller.search(7, undefined)).rejects.toMatchObject({
      response: { error: 'query_too_short' },
    });
    service.hasFolderConfigured
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    await expect(controller.search(7, 'data')).rejects.toMatchObject({
      status: 409,
      response: { error: 'no_folder_configured' },
    });
    expect(service.search).not.toHaveBeenCalled();
    const hits = [
      { indexedFileId: 10, filename: 'notes.txt', snippet: 'data', score: 0.8 },
    ];
    service.search.mockResolvedValue(hits);
    await expect(controller.search(7, '  data  ')).resolves.toEqual({ hits });
    await controller.search(7, 'data', '999');
    await controller.search(7, 'data', '-5');
    expect(service.hasFolderConfigured).toHaveBeenCalledWith(owner);
    expect(service.search.mock.calls).toEqual([
      [owner, 'data', 10],
      [owner, 'data', 25],
      [owner, 'data', 1],
    ]);
  });

  it('returns reads by file ID or name and maps file states to their HTTP status', async () => {
    const found = {
      ok: true,
      filename: 'notes.txt',
      content: 'sample',
      indexedFileId: 10,
    };
    service.readWithSync.mockResolvedValue(found);
    await expect(controller.readContent(7, 10)).resolves.toBe(found);
    await expect(controller.readByFilename(7, 'notes.txt')).resolves.toBe(
      found,
    );
    await controller.readByFilename(7, undefined);
    expect(service.readWithSync.mock.calls).toEqual([
      [owner, { indexedFileId: 10 }],
      [owner, { filename: 'notes.txt' }],
      [owner, { filename: '' }],
    ]);

    const states = [
      ['not_found', HttpStatus.NOT_FOUND],
      ['ambiguous', HttpStatus.CONFLICT],
      ['not_ready', HttpStatus.ACCEPTED],
      ['not_extractable', HttpStatus.UNPROCESSABLE_ENTITY],
    ];
    for (const [error, status] of states) {
      const state = { ok: false, error };
      service.readWithSync.mockResolvedValueOnce(state);
      await expect(controller.readContent(7, 10)).rejects.toMatchObject({
        status,
        response: state,
      });
    }
  });
});
