import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { CommentService } from './comment.service';
import { Comment } from './comment.interface';

@Controller('comments')
export class CommentController {
  constructor(private readonly commentService: CommentService) { }

  @Get(':id')
  async getId(@Param('id') id: string): Promise<Comment> {
    return await this.commentService.findOne(id);
  }

  @Get('doc/:docId')
  async getByDoc(@Param('docId') docId: string): Promise<Comment[]> {
    return await this.commentService.findByDoc(docId);
  }

  @Post()
  async create(@Body() doc: Comment): Promise<Comment> {
    return await this.commentService.create(doc);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() doc: Partial<Comment>,
  ): Promise<Comment> {
    return await this.commentService.update(id, doc);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    return await this.commentService.delete(id);
  }
}
