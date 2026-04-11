import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { ResourceEntity } from '../resource/resource.entity';
import { ProjectEntity } from '../project/project.entity';
import { DocEntity } from '../doc/doc.entity';
import { FileStorageService } from '../file-storage/file-storage.service';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HTMLtoDOCX = require('html-to-docx');

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
      select: ['id', 'name', 'description', 'createdAt'],
    });
  }

  async createExportArchive(
    projectIds: number[],
    includeOriginalFiles: boolean,
    includeMetadata: boolean,
    includeContent: boolean,
    convertToDocx: boolean = false,
  ): Promise<{ stream: PassThrough; filename: string }> {
    const passThrough = new PassThrough();
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(passThrough);

    // Determine which projects to export
    let projects: ProjectEntity[];
    if (projectIds.length === 0) {
      projects = await this.projectRepo.find({
        order: { name: 'ASC' },
      });
    } else {
      projects = await this.projectRepo.find({
        where: { id: In(projectIds) },
        order: { name: 'ASC' },
      });
    }

    const exportManifest: any = {
      exportDate: new Date().toISOString(),
      projectCount: projects.length,
      projects: [],
    };

    for (const project of projects) {
      const resources = await this.resourceRepo.find({
        where: { project: { id: project.id } },
        relations: ['authors', 'entities'],
      });

      // Get docs for this project (exclude resource workspace docs)
      const docs = await this.docRepo
        .createQueryBuilder('d')
        .leftJoinAndSelect('d.comments', 'comments')
        .leftJoinAndSelect('d.marks', 'marks')
        .where('d.projectId = :projectId', { projectId: project.id })
        .andWhere('d."resourceId" IS NULL')
        .orderBy('d.created_at', 'DESC')
        .getMany();

      const sanitizedProjectName = this.sanitizeFolderName(project.name);

      for (const resource of resources) {
        const resourceBaseName = this.getBaseName(resource.originalName || resource.name || `resource-${resource.id}`);
        const resourceMeta: any = {
          id: resource.id,
          name: resource.name,
          title: resource.title,
          originalName: resource.originalName,
          mimeType: resource.mimeType,
          fileSize: resource.fileSize,
          pages: resource.pages,
          language: resource.language,
          status: resource.status,
          uploadDate: resource.uploadDate,
          publicationDate: resource.publicationDate,
          url: resource.url,
          summary: resource.summary,
          keyPoints: resource.keyPoints,
          keywords: resource.keywords,
          authors: resource.authors?.map((a) => ({ id: a.id, name: a.name })),
          entities: resource.entities?.map((e) => ({ id: e.id, name: e.name })),
        };

        // Add original file
        if (includeOriginalFiles && resource.path) {
          const fileBuffer = await this.fileStorageService.getFile(resource.path);
          if (fileBuffer) {
            const fileName = resource.originalName || `resource-${resource.id}`;
            archive.append(fileBuffer, {
              name: `${sanitizedProjectName}/files/${fileName}`,
            });
          }
        }

        // Add extracted content
        if (includeContent && resource.content) {
          if (convertToDocx) {
            const docxBuffer = await this.htmlToDocx(resource.content);
            archive.append(docxBuffer, {
              name: `${sanitizedProjectName}/content/${resourceBaseName}.docx`,
            });
          } else {
            archive.append(resource.content, {
              name: `${sanitizedProjectName}/content/${resourceBaseName}.html`,
            });
          }
        }

        // Add translated content if available
        if (includeContent && resource.translatedContent) {
          if (convertToDocx) {
            const docxBuffer = await this.htmlToDocx(resource.translatedContent);
            archive.append(docxBuffer, {
              name: `${sanitizedProjectName}/translated/${resourceBaseName}.docx`,
            });
          } else {
            archive.append(resource.translatedContent, {
              name: `${sanitizedProjectName}/translated/${resourceBaseName}.html`,
            });
          }
        }

        // Add individual metadata file for this resource
        if (includeMetadata) {
          archive.append(JSON.stringify(resourceMeta, null, 2), {
            name: `${sanitizedProjectName}/files/${resourceBaseName}.metadata.json`,
          });
        }
      }

      // Process docs
      for (const doc of docs) {
        const docFileName = this.sanitizeFolderName(doc.name) || `doc-${doc.id}`;
        const docMeta: any = {
          id: doc.id,
          name: doc.name,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          comments: doc.comments?.map((c) => ({
            id: c.id,
            content: c.content,
            createdAt: c.createdAt,
          })),
          marks: doc.marks?.map((m) => ({
            id: m.id,
            content: m.content,
            createdAt: m.createdAt,
          })),
        };

        // Add doc content
        if (includeContent && doc.content) {
          if (convertToDocx) {
            const docxBuffer = await this.htmlToDocx(doc.content);
            archive.append(docxBuffer, {
              name: `${sanitizedProjectName}/docs/${docFileName}.docx`,
            });
          } else {
            archive.append(doc.content, {
              name: `${sanitizedProjectName}/docs/${docFileName}.html`,
            });
          }
        }

        // Add individual metadata file for this doc
        if (includeMetadata) {
          archive.append(JSON.stringify(docMeta, null, 2), {
            name: `${sanitizedProjectName}/docs/${docFileName}.metadata.json`,
          });
        }
      }

      exportManifest.projects.push({
        name: project.name,
        resourceCount: resources.length,
        docCount: docs.length,
      });
    }

    // Also export resources and docs without a project
    const orphanResources = await this.resourceRepo.find({
      where: { project: IsNull() },
      relations: ['authors', 'entities'],
    });

    const orphanDocs = await this.docRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.comments', 'comments')
      .leftJoinAndSelect('d.marks', 'marks')
      .where('d."projectId" IS NULL')
      .andWhere('d."resourceId" IS NULL')
      .orderBy('d.created_at', 'DESC')
      .getMany();

    if (orphanResources.length > 0 || orphanDocs.length > 0) {
      for (const resource of orphanResources) {
        const resourceBaseName = this.getBaseName(resource.originalName || resource.name || `resource-${resource.id}`);
        const resourceMeta: any = {
          id: resource.id,
          name: resource.name,
          title: resource.title,
          originalName: resource.originalName,
          mimeType: resource.mimeType,
          fileSize: resource.fileSize,
          language: resource.language,
          status: resource.status,
        };

        if (includeOriginalFiles && resource.path) {
          const fileBuffer = await this.fileStorageService.getFile(resource.path);
          if (fileBuffer) {
            const fileName = resource.originalName || `resource-${resource.id}`;
            archive.append(fileBuffer, {
              name: `_sin_proyecto/files/${fileName}`,
            });
          }
        }

        if (includeContent && resource.content) {
          if (convertToDocx) {
            const docxBuffer = await this.htmlToDocx(resource.content);
            archive.append(docxBuffer, {
              name: `_sin_proyecto/content/${resourceBaseName}.docx`,
            });
          } else {
            archive.append(resource.content, {
              name: `_sin_proyecto/content/${resourceBaseName}.html`,
            });
          }
        }

        if (includeMetadata) {
          archive.append(JSON.stringify(resourceMeta, null, 2), {
            name: `_sin_proyecto/files/${resourceBaseName}.metadata.json`,
          });
        }
      }

      for (const doc of orphanDocs) {
        const docFileName = this.sanitizeFolderName(doc.name) || `doc-${doc.id}`;
        const docMeta: any = {
          id: doc.id,
          name: doc.name,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          comments: doc.comments?.map((c) => ({
            id: c.id,
            content: c.content,
            createdAt: c.createdAt,
          })),
          marks: doc.marks?.map((m) => ({
            id: m.id,
            content: m.content,
            createdAt: m.createdAt,
          })),
        };

        if (includeContent && doc.content) {
          if (convertToDocx) {
            const docxBuffer = await this.htmlToDocx(doc.content);
            archive.append(docxBuffer, {
              name: `_sin_proyecto/docs/${docFileName}.docx`,
            });
          } else {
            archive.append(doc.content, {
              name: `_sin_proyecto/docs/${docFileName}.html`,
            });
          }
        }

        if (includeMetadata) {
          archive.append(JSON.stringify(docMeta, null, 2), {
            name: `_sin_proyecto/docs/${docFileName}.metadata.json`,
          });
        }
      }

      exportManifest.projects.push({
        name: 'Sin proyecto',
        resourceCount: orphanResources.length,
        docCount: orphanDocs.length,
      });
    }

    // Add global manifest
    archive.append(JSON.stringify(exportManifest, null, 2), {
      name: 'manifest.json',
    });

    archive.finalize();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = projectIds.length === 0
      ? `export-all-${timestamp}.zip`
      : `export-projects-${timestamp}.zip`;

    return { stream: passThrough, filename };
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

  private async htmlToDocx(html: string): Promise<Buffer> {
    const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    return await HTMLtoDOCX(wrappedHtml, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      header: false,
    });
  }
}
