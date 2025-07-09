import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Resource } from './resource.interface';
import { ResourceService } from './resource.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { JobService } from '../job/job.service';
import { AlreadyExistException } from '../common/exceptions/already-exist.exception';
import { JobPriority } from 'src/job/job.interface';

@Controller('resources')
export class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly fileStorageService: FileStorageService,
    private readonly jobService: JobService,
  ) { }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Resource> {
    return await this.resourceService.findOne(id);
  }

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId') projectId: string,
  ): Promise<Resource[]> {
    return await this.resourceService.findByProject(projectId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() resource: Partial<Resource>,
  ): Promise<Resource> {
    return await this.resourceService.update(id, resource);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    const resource = await this.resourceService.remove(id);
    if (resource && resource.path) {
      await this.fileStorageService.deleteFile(resource.path);
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    resourceData: {
      name: string;
      projectId: string;
      type?: string;
      url?: string;
      relatedTo?: string;
      originalName?: string;
    },
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    try {
      const hash = await this.fileStorageService.calculateHash(file.buffer);

      const existingResource = await this.resourceService.findByHash(hash);
      if (existingResource) {
        throw new AlreadyExistException('File', 'File with the same content already exists');
      }

      const result = await this.fileStorageService.storeFile(
        hash,
        file.buffer,
        file.originalname,
      );

      const resourceToCreate: any = {
        name: resourceData.name || file.originalname,
        project: resourceData.projectId,
        hash: hash,
        mimeType: file.mimetype,
        originalName: resourceData.originalName || file.originalname,
        path: result.relativePath,
        uploadDate: new Date(),
        fileSize: file.size,
      };

      if (resourceData.type && resourceData.type === 'webpage') {
        resourceToCreate.type = '000000000000000000000032';
      }

      if (resourceData.url) {
        resourceToCreate.url = resourceData.url;
      }

      if (resourceData.relatedTo) {
        resourceToCreate.relatedTo = resourceData.relatedTo;
      }

      const resourceCreated = await this.resourceService.create(resourceToCreate);
      if (!file.mimetype.startsWith('image/')) {
        await this.jobService.create(
          'document-extraction',
          JobPriority.NORMAL,
          {
            hash: result.hash,
            extension: result.extension,
            resourceId: resourceCreated._id,
          },
        );
      }

      return {
        success: true,
      };
    } catch (error) {
      if (error instanceof AlreadyExistException) {
        throw error;
      }

      throw new HttpException(
        `${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/download')
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    const resource = await this.resourceService.findOne(id);

    if (!resource || !resource.path) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    const file = await this.fileStorageService.getFile(resource.path);

    if (!file) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    res.setHeader('Content-Type', resource.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${resource.originalName}"`,
    );
    res.send(file);
  }

  @Get(':id/view')
  async viewFile(@Param('id') id: string, @Res() res: Response) {
    const resource = await this.resourceService.findOne(id);

    if (!resource || !resource.path) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    const file = await this.fileStorageService.getFile(resource.path);

    if (!file) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    res.setHeader('Content-Type', resource.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.send(file);
  }
}
