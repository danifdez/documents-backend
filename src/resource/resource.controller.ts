import { Controller, Get, Post, Body, Param, Delete, Patch, UseInterceptors, UploadedFile, Req, Res, HttpException, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { ResourceService } from './resource.service';
import { ResourceEntity } from './resource.entity';
import { AuthorService } from '../author/author.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { UpdateResourceDto } from './dto/update-resource.dto';
import { UploadResourceDto } from './dto/upload-resource.dto';

@Controller('resources')
export class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly authorService: AuthorService,
  ) { }

  @Get()
  async findAll(): Promise<ResourceEntity[]> {
    return await this.resourceService.findAllWithProjects();
  }

  @Get('pending')
  async getPending(): Promise<ResourceEntity[]> {
    return await this.resourceService.findPending();
  }

  @Patch(':id/assign')
  async assignToProject(
    @Param('id', ParseIntPipe) id: number,
    @Body('projectId', ParseIntPipe) projectId: number,
  ): Promise<ResourceEntity> {
    const resource = await this.resourceService.assignToProject(id, projectId);
    if (!resource) {
      throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ResourceEntity | null> {
    return await this.resourceService.findOne(id);
  }

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ResourceEntity[]> {
    return await this.resourceService.findByProject(projectId);
  }

  @Get('entity/:entityId')
  async getByEntityId(
    @Param('entityId', ParseIntPipe) entityId: number,
  ): Promise<ResourceEntity[]> {
    return await this.resourceService.findByEntityId(entityId);
  }

  @Get('entity/search/:entityName')
  async getByEntityName(
    @Param('entityName') entityName: string,
  ): Promise<ResourceEntity[]> {
    return await this.resourceService.findByEntityName(entityName);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResourceDto,
  ): Promise<ResourceEntity | null> {
    return await this.resourceService.update(id, dto);
  }

  @Post(':id/confirm')
  async confirmResource(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; message: string }> {
    return await this.resourceService.confirmExtraction(id);
  }

  @Post(':id/promote')
  async promoteTemp(@Param('id', ParseIntPipe) id: number): Promise<ResourceEntity> {
    return await this.resourceService.promoteTemp(id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DELETE)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.resourceService.removeWithFile(id);
  }

  @Delete(':id/entities/:entityId')
  async removeEntityFromResource(
    @Param('id', ParseIntPipe) resourceId: number,
    @Param('entityId', ParseIntPipe) entityId: number,
  ): Promise<void> {
    await this.resourceService.removeEntityFromResource(resourceId, entityId);
  }

  @Post(':id/authors/:authorId')
  async addAuthorToResource(
    @Param('id', ParseIntPipe) resourceId: number,
    @Param('authorId', ParseIntPipe) authorId: number,
  ): Promise<void> {
    const author = await this.authorService.findOne(authorId);
    if (!author) {
      throw new HttpException('Author not found', HttpStatus.NOT_FOUND);
    }
    await this.resourceService.addAuthorToResource(resourceId, author);
  }

  @Delete(':id/authors/:authorId')
  async removeAuthorFromResource(
    @Param('id', ParseIntPipe) resourceId: number,
    @Param('authorId', ParseIntPipe) authorId: number,
  ): Promise<void> {
    await this.resourceService.removeAuthorFromResource(resourceId, authorId);
  }

  @Delete(':id/authors')
  async clearResourceAuthors(
    @Param('id', ParseIntPipe) resourceId: number,
  ): Promise<void> {
    await this.resourceService.clearResourceAuthors(resourceId);
  }

  @Post('upload')
  @RequirePermissions(Permission.UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() resourceData: UploadResourceDto,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }
    return await this.resourceService.uploadAndProcess(file, resourceData);
  }

  @Get(':id/download')
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { buffer, resource } = await this.resourceService.getFileBuffer(id);
    const safeName = resource.originalName.replace(/[^\w.\-]/g, '_');
    res.setHeader('Content-Type', resource.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(resource.originalName)}`);
    res.send(buffer);
  }

  @Get(':id/view')
  async viewFile(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { buffer, resource } = await this.resourceService.getFileBuffer(id);
    const total = buffer.length;

    res.setHeader('Content-Type', resource.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      res.send(buffer.subarray(start, end + 1));
    } else {
      res.setHeader('Content-Length', total);
      res.send(buffer);
    }
  }

  @Get(':id/content')
  async getContent(@Param('id', ParseIntPipe) id: number) {
    const exists = await this.resourceService.resourceExists(id);
    if (!exists) {
      throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
    }
    const content = await this.resourceService.getContentById(id);
    return { content: content ?? null };
  }

  @Get(':id/translated-content')
  async getTranslatedContent(@Param('id', ParseIntPipe) id: number) {
    const translated = await this.resourceService.getTranslatedContentById(id);
    if (!translated) {
      throw new HttpException('Translated content not found', HttpStatus.NOT_FOUND);
    }
    return { translatedContent: translated };
  }

  @Get(':id/entities')
  async getEntities(@Param('id', ParseIntPipe) id: number) {
    const exists = await this.resourceService.resourceExists(id);
    if (!exists) {
      throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
    }
    return await this.resourceService.getEntitiesByResourceId(id);
  }
}
