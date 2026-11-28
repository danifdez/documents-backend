import { forEachSequential } from '../utils/for-each-sequential';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { ResourceEntity } from '../resource/resource.entity';
import { ProjectEntity } from '../project/project.entity';
import { DocEntity } from '../doc/doc.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import { renderHtmlToDocx } from '../common/html-to-docx';
import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';

interface ExportedProject {
  name: string;
  resourceCount: number;
  docCount: number;
}

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly resourceRepo: Repository<ResourceEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(DocEntity)
    private readonly docRepo: Repository<DocEntity>,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async getProjectsForExport(): Promise<ProjectEntity[]> {
    return await this.projectRepo.find({
      order: { name: 'ASC' },
      select: { id: true, name: true, description: true, createdAt: true },
    });
  }

  async createExportArchive(
    projectIds: number[],
    convertToDocx: boolean = false,
  ): Promise<{ stream: PassThrough; filename: string }> {
    const passThrough = new PassThrough();
    const archive = new ZipArchive({ zlib: { level: 6 } });

    archive.pipe(passThrough);

    const projects = await this.projectRepo.find({
      ...(projectIds.length ? { where: { id: In(projectIds) } } : {}),
      order: { name: 'ASC' },
    });
    const exportManifest = {
      exportDate: new Date().toISOString(),
      projectCount: projects.length,
      projects: [] as ExportedProject[],
    };

    await forEachSequential(projects, async (project) => {
      exportManifest.projects.push(
        await this.appendProject(
          archive,
          this.sanitizeFolderName(project.name),
          project.name,
          convertToDocx,
          project.id,
        ),
      );
    });
    const orphans = await this.appendProject(
      archive,
      '_sin_proyecto',
      'Sin proyecto',
      convertToDocx,
    );
    if (orphans.resourceCount || orphans.docCount) {
      exportManifest.projects.push(orphans);
    }

    // Add global manifest
    archive.append(JSON.stringify(exportManifest, null, 2), {
      name: 'manifest.json',
    });

    archive.finalize();

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const filename =
      projectIds.length === 0
        ? `export-all-${timestamp}.zip`
        : `export-projects-${timestamp}.zip`;

    return { stream: passThrough, filename };
  }

  private async appendProject(
    archive: ZipArchive,
    folder: string,
    name: string,
    convertToDocx: boolean,
    projectId?: number,
  ): Promise<ExportedProject> {
    const resources = await this.resourceRepo.find({
      where: {
        project: projectId === undefined ? IsNull() : { id: projectId },
      },
      relations: { authors: true, entities: true },
    });
    const docsQuery = this.docRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.comments', 'comments')
      .leftJoinAndSelect('d.marks', 'marks');
    if (projectId === undefined) {
      docsQuery.where('d."projectId" IS NULL');
    } else {
      docsQuery.where('d.projectId = :projectId', { projectId });
    }
    const docs = await docsQuery
      .andWhere('d."resourceId" IS NULL')
      .orderBy('d.created_at', 'DESC')
      .getMany();
    const includeProjectDetails = projectId !== undefined;
    await forEachSequential(resources, (resource) =>
      this.appendResource(
        archive,
        folder,
        resource,
        convertToDocx,
        includeProjectDetails,
      ),
    );
    await forEachSequential(docs, (doc) =>
      this.appendDocument(archive, folder, doc, convertToDocx),
    );
    return { name, resourceCount: resources.length, docCount: docs.length };
  }

  private async appendResource(
    archive: ZipArchive,
    folder: string,
    resource: ResourceEntity,
    convertToDocx: boolean,
    includeProjectDetails: boolean,
  ): Promise<void> {
    const baseName = this.getBaseName(
      resource.originalName || resource.name || `resource-${resource.id}`,
    );
    const metadata = {
      id: resource.id,
      name: resource.name,
      title: resource.title,
      originalName: resource.originalName,
      mimeType: resource.mimeType,
      fileSize: resource.fileSize,
      ...(includeProjectDetails ? { pages: resource.pages } : {}),
      language: resource.language,
      status: resource.status,
      ...(includeProjectDetails
        ? {
            uploadDate: resource.uploadDate,
            publicationDate: resource.publicationDate,
            url: resource.url,
            summary: resource.summary,
            keyPoints: resource.keyPoints,
            keywords: resource.keywords,
            authors: resource.authors?.map(({ id, name }) => ({ id, name })),
            entities: resource.entities?.map(({ id, name }) => ({ id, name })),
          }
        : {}),
    };
    if (resource.path) {
      const buffer = await this.fileStorageService.getFile(resource.path);
      if (buffer) {
        const fileName = resource.originalName || `resource-${resource.id}`;
        archive.append(buffer, { name: `${folder}/files/${fileName}` });
      }
    }
    if (resource.content) {
      await this.appendHtmlContent(
        archive,
        resource.content,
        `${folder}/content/${baseName}`,
        convertToDocx,
      );
    }
    if (includeProjectDetails && resource.translatedContent) {
      await this.appendHtmlContent(
        archive,
        resource.translatedContent,
        `${folder}/translated/${baseName}`,
        convertToDocx,
      );
    }
    archive.append(JSON.stringify(metadata, null, 2), {
      name: `${folder}/files/${baseName}.metadata.json`,
    });
  }

  private async appendDocument(
    archive: ZipArchive,
    folder: string,
    doc: DocEntity,
    convertToDocx: boolean,
  ): Promise<void> {
    const name = this.sanitizeFolderName(doc.name) || `doc-${doc.id}`;
    const basePath = `${folder}/docs/${name}`;
    const metadata = {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      comments: doc.comments?.map(({ id, content, createdAt }) => ({
        id,
        content,
        createdAt,
      })),
      marks: doc.marks?.map(({ id, content, createdAt }) => ({
        id,
        content,
        createdAt,
      })),
    };
    if (doc.content) {
      await this.appendHtmlContent(
        archive,
        doc.content,
        basePath,
        convertToDocx,
      );
    }
    archive.append(JSON.stringify(metadata, null, 2), {
      name: `${basePath}.metadata.json`,
    });
  }

  private sanitizeFolderName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  private getBaseName(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot <= 0) return filename;
    return filename.substring(0, lastDot);
  }

  private async appendHtmlContent(
    archive: ZipArchive,
    html: string,
    basePath: string,
    convertToDocx: boolean,
  ): Promise<void> {
    if (convertToDocx) {
      const docxBuffer = await renderHtmlToDocx(html);
      archive.append(docxBuffer, { name: `${basePath}.docx` });
      return;
    }
    archive.append(html, { name: `${basePath}.html` });
  }
}
