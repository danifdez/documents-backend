import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { MarkService } from './mark.service';
import { Mark } from './mark.interface';

@Controller('marks')
export class MarkController {
  constructor(private readonly markService: MarkService) { }

  @Get(':id')
  async getId(@Param('id') id: string): Promise<Mark> {
    return await this.markService.findOne(id);
  }

  @Get('doc/:docId')
  async getByDoc(@Param('docId') docId: string): Promise<Mark[]> {
    return await this.markService.findByDoc(docId);
  }

  @Post()
  async create(@Body() doc: Mark): Promise<Mark> {
    return await this.markService.create(doc);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() doc: Partial<Mark>,
  ): Promise<Mark> {
    return await this.markService.update(id, doc);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    return await this.markService.delete(id);
  }
}
