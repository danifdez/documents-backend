import { ExportService } from '../../../src/export/export.service';
import { renderHtmlToDocx } from '../../../src/common/html-to-docx';

const mockArchive = {
  append: jest.fn(),
  pipe: jest.fn(),
  finalize: jest.fn(),
};

jest.mock('archiver', () => ({ ZipArchive: jest.fn(() => mockArchive) }));
jest.mock('../../../src/common/html-to-docx', () => ({
  renderHtmlToDocx: jest.fn(),
}));

const renderHtmlToDocxMock = renderHtmlToDocx as jest.Mock;

interface ExportFixture {
  projects?: Array<Record<string, unknown>>;
  projectResources?: Array<Record<string, unknown>>;
  orphanResources?: Array<Record<string, unknown>>;
  docs?: Array<Record<string, unknown>>;
  orphanDocs?: Array<Record<string, unknown>>;
}

function createDocQuery(docs: Array<Record<string, unknown>>) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(docs),
  };
}

function setup({
  projects = [],
  projectResources = [],
  orphanResources = [],
  docs = [],
  orphanDocs = [],
}: ExportFixture) {
  const resourceRepo = {
    find: jest.fn(async ({ where }: any) =>
      where.project?.id ? projectResources : orphanResources,
    ),
  };
  const projectRepo = {
    find: jest.fn().mockResolvedValue(projects),
  };
  const docResults = [...projects.map(() => docs), orphanDocs];
  const docRepo = {
    createQueryBuilder: jest.fn(() => createDocQuery(docResults.shift() ?? [])),
  };
  const fileStorageService = { getFile: jest.fn() };

  return new ExportService(
    resourceRepo as any,
    projectRepo as any,
    docRepo as any,
    fileStorageService as any,
  );
}

function appendedContent() {
  return mockArchive.append.mock.calls
    .map(([body, options]) => ({ body, name: options.name }))
    .filter(({ name }) => /\.(html|docx)$/.test(name));
}

describe('ExportService HTML content', () => {
  beforeEach(() => {
    mockArchive.append.mockReset();
    mockArchive.pipe.mockReset();
    mockArchive.finalize.mockReset();
    renderHtmlToDocxMock.mockReset();
    renderHtmlToDocxMock.mockResolvedValue(Buffer.from('docx'));
  });

  it('converts project resources, translations and docs to DOCX', async () => {
    const service = setup({
      projects: [{ id: 7, name: 'Research Project' }],
      projectResources: [
        {
          id: 1,
          name: 'Paper',
          originalName: 'paper.pdf',
          content: '<p>Resource</p>',
          translatedContent: '<p>Translated</p>',
          path: null,
        },
      ],
      docs: [{ id: 2, name: 'My Notes', content: '<p>Document</p>' }],
    });

    const { stream } = await service.createExportArchive([7], true);

    expect(renderHtmlToDocxMock.mock.calls).toEqual([
      ['<p>Resource</p>'],
      ['<p>Translated</p>'],
      ['<p>Document</p>'],
    ]);
    expect(appendedContent()).toEqual([
      {
        body: expect.any(Buffer),
        name: 'Research_Project/content/paper.docx',
      },
      {
        body: expect.any(Buffer),
        name: 'Research_Project/translated/paper.docx',
      },
      {
        body: expect.any(Buffer),
        name: 'Research_Project/docs/My_Notes.docx',
      },
    ]);
    expect(mockArchive.pipe).toHaveBeenCalledWith(stream);
    expect(mockArchive.finalize).toHaveBeenCalledTimes(1);
  });

  it('keeps orphan resources and docs as HTML by default', async () => {
    const service = setup({
      orphanResources: [
        {
          id: 3,
          name: 'Orphan',
          originalName: 'orphan.pdf',
          content: '<p>Orphan resource</p>',
          path: null,
        },
      ],
      orphanDocs: [
        { id: 4, name: 'Loose Notes', content: '<p>Orphan document</p>' },
      ],
    });

    await service.createExportArchive([]);

    expect(renderHtmlToDocxMock).not.toHaveBeenCalled();
    expect(appendedContent()).toEqual([
      {
        body: '<p>Orphan resource</p>',
        name: '_sin_proyecto/content/orphan.html',
      },
      {
        body: '<p>Orphan document</p>',
        name: '_sin_proyecto/docs/Loose_Notes.html',
      },
    ]);
  });
});
