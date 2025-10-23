import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { MarkService } from './mark.service';
import { MarkEntity } from './mark.entity';

@Controller('marks')
export class MarkController {
  constructor(private readonly markService: MarkService) { }

  @Get(':id')
  async getId(@Param('id', ParseIntPipe) id: number): Promise<MarkEntity | null> {
    return await this.markService.findOne(id);
  }

  @Get('doc/:docId')
  async getByDoc(
    @Param('docId', ParseIntPipe) docId: number,
  ): Promise<MarkEntity[]> {
    return await this.markService.findByDoc(docId);
  }

  @Get('resource/:resourceId')
  async getByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<MarkEntity[]> {
    return await this.markService.findByResource(resourceId);
  }

  @Post()
  async create(@Body() body: any): Promise<MarkEntity> {
    const markData: Partial<MarkEntity> = {
      content: body.content,
    };

    // Support both doc and resource
    if (body.doc) {
      markData.doc = { id: parseInt(body.doc) } as any;
    } else if (body.resource) {
      markData.resource = { id: parseInt(body.resource) } as any;
    }

    return await this.markService.create(markData);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() doc: Partial<MarkEntity>,
  ): Promise<MarkEntity | null> {
    return await this.markService.update(id, doc);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.markService.delete(id);
  }
}
