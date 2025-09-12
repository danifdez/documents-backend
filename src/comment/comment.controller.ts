import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { CommentService } from './comment.service';
import { CommentEntity } from 'src/comment/comment.entity';

@Controller('comments')
export class CommentController {
  constructor(private readonly commentService: CommentService) { }

  @Get(':id')
  async getId(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommentEntity | null> {
    return await this.commentService.findOne(id);
  }

  @Get('doc/:docId')
  async getByDoc(
    @Param('docId', ParseIntPipe) docId: number,
  ): Promise<CommentEntity[]> {
    return await this.commentService.findByDoc(docId);
  }

  @Post()
  async create(@Body() doc: CommentEntity): Promise<CommentEntity> {
    return await this.commentService.create(doc);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() doc: Partial<CommentEntity>,
  ): Promise<CommentEntity | null> {
    return await this.commentService.update(id, doc);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.commentService.delete(id);
  }
}
