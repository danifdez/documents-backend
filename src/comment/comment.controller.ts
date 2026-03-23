import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe } from '@nestjs/common';
import { CommentService } from './comment.service';
import { CommentEntity } from 'src/comment/comment.entity';
import { CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

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

  @Get('resource/:resourceId')
  async getByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<CommentEntity[]> {
    return await this.commentService.findByResource(resourceId);
  }

  @Post()
  @RequirePermissions(Permission.WRITE)
  async create(@Body() dto: CreateCommentDto): Promise<CommentEntity> {
    const commentData: Partial<CommentEntity> = {
      content: dto.content,
    };

    if (dto.doc) {
      commentData.doc = { id: dto.doc } as any;
    } else if (dto.resource) {
      commentData.resource = { id: dto.resource } as any;
    }

    return await this.commentService.create(commentData);
  }

  @Patch(':id')
  @RequirePermissions(Permission.WRITE)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentEntity | null> {
    return await this.commentService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DELETE)
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.commentService.delete(id);
  }
}
