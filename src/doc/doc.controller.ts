import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { DocService } from './doc.service';
import { DocEntity } from 'src/doc/doc.entity';

@Controller('docs')
export class DocController {
  constructor(private readonly docService: DocService) { }

  @Get(':id')
  async getId(@Param('id', ParseIntPipe) id: number): Promise<DocEntity | null> {
    return await this.docService.findOne(id);
  }

  @Get('thread/:threadId')
  async getByThread(
    @Param('threadId', ParseIntPipe) threadId: number,
  ): Promise<DocEntity[]> {
    return await this.docService.findByThread(threadId);
  }

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<DocEntity[]> {
    return await this.docService.findByProject(projectId);
  }

  @Get('resource/:resourceId')
  async getByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<DocEntity | null> {
    return await this.docService.findByResource(resourceId);
  }

  @Post()
  async create(@Body() doc: Partial<DocEntity>): Promise<DocEntity> {
    return await this.docService.create(doc);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number, @Body() doc: Partial<DocEntity>): Promise<DocEntity | null> {
    return await this.docService.update(id, doc);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.docService.remove(id);
  }
}
