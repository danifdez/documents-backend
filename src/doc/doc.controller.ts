import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { DocService } from './doc.service';
import { Doc } from './doc.interface';

@Controller('docs')
export class DocController {
  constructor(private readonly docService: DocService) { }

  @Get(':id')
  async getId(@Param('id') id: string): Promise<Doc> {
    return await this.docService.findOne(id);
  }

  @Get('thread/:threadId')
  async getByThread(@Param('threadId') threadId: string): Promise<Doc[]> {
    return await this.docService.findByThread(threadId);
  }

  @Post()
  async create(@Body() doc: Doc): Promise<Doc> {
    return await this.docService.create(doc);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() doc: Partial<Doc>): Promise<Doc> {
    return await this.docService.update(id, doc);
  }
}
