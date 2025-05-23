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

  @Post()
  async create(@Body() resource: Resource): Promise<Resource> {
    const resourceCreated = await this.resourceService.create(resource);
    return resourceCreated;
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
    await this.resourceService.remove(id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    resourceData: {
      name: string;
      projectId: string;
      typeId?: string;
      description?: string;
      source?: string;
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
        description: resourceData.description || '',
        source: resourceData.source || 'manual',
        mimeType: file.mimetype,
        originalName: file.originalname,
        path: result.relativePath,
        uploadDate: new Date(),
        fileSize: file.size,
      };

      if (resourceData.typeId && this.isValidObjectId(resourceData.typeId)) {
        resourceToCreate.type = resourceData.typeId;
      }

      await this.resourceService.create(resourceToCreate);
      await this.jobService.create('document-extraction', {
        hash: result.hash,
        extension: result.extension,
        resourceId: resourceToCreate._id,
      });

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
  /**
   * Validates if the given ID is a valid MongoDB ObjectId.
   * @param id The ID to validate.
   * @returns True if the ID is valid, false otherwise.
   */
  private isValidObjectId(id: string): boolean {
    const objectIdPattern = /^[0-9a-fA-F]{24}$/;
    return objectIdPattern.test(id);
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

    const metadata = resource.metadata as any;
    const contentType = resource.mimeType || metadata?.mimeType || 'application/octet-stream';

    const filename = resource.originalName ||
      metadata?.originalName ||
      `resource-${resource._id}${metadata?.extension || ''}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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

    const metadata = resource.metadata as any;
    const contentType = resource.mimeType || metadata?.mimeType || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.send(file);
  }
}
