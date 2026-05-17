import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpException,
  HttpStatus,
  ConflictException,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IndexedFileService, ScanFolderResult, ReadWithSyncResult } from './indexed-file.service';
import { IndexedFileDto, toIndexedFileDto } from './dto/indexed-file.dto';
import { WriteIndexedFileDto } from './dto/write-indexed-file.dto';

@Controller('assistants/:assistantId/indexed-files')
export class IndexedFileController {
  constructor(private readonly indexedFileService: IndexedFileService) {}

  @Get()
  async list(
    @Param('assistantId', ParseIntPipe) assistantId: number,
  ): Promise<IndexedFileDto[]> {
    const files = await this.indexedFileService.findByAssistant(assistantId);
    return files.map(toIndexedFileDto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async write(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Body() dto: WriteIndexedFileDto,
  ): Promise<IndexedFileDto> {
    if (dto.content === undefined && dto.contentBase64 === undefined) {
      throw new BadRequestException({ error: 'missing_content' });
    }
    if (dto.content !== undefined && dto.contentBase64 !== undefined) {
      throw new BadRequestException({ error: 'ambiguous_content' });
    }
    let payload: string | Buffer;
    if (dto.contentBase64 !== undefined) {
      try {
        payload = Buffer.from(dto.contentBase64, 'base64');
      } catch {
        throw new BadRequestException({ error: 'invalid_base64' });
      }
    } else {
      payload = dto.content as string;
    }
    try {
      const file = await this.indexedFileService.writeFile(
        assistantId,
        dto.filename,
        payload,
        { overwrite: dto.overwrite === true },
      );
      return toIndexedFileDto(file);
    } catch (err: any) {
      if (err instanceof ConflictException) {
        throw new HttpException(
          { error: err.message, filename: dto.filename },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 250 * 1024 * 1024 } }))
  async upload(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('filename') filenameOverride?: string,
  ): Promise<IndexedFileDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException({ error: 'missing_file' });
    }
    const filename = (filenameOverride && filenameOverride.trim()) || file.originalname;
    if (!filename) {
      throw new BadRequestException({ error: 'missing_filename' });
    }
    try {
      const saved = await this.indexedFileService.writeFile(
        assistantId,
        filename,
        file.buffer,
        { overwrite: false },
      );
      return toIndexedFileDto(saved);
    } catch (err: any) {
      if (err instanceof ConflictException) {
        throw new HttpException(
          { error: err.message, filename },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  @Get('search')
  async search(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Query('query') query: string,
    @Query('limit') limit?: string,
  ): Promise<{ hits: Array<{ indexedFileId: number; filename: string; snippet: string; score: number }> }> {
    const q = (query ?? '').trim();
    if (q.length < 3) {
      throw new BadRequestException({ error: 'query_too_short' });
    }
    const hasFolder = await this.indexedFileService.hasFolderConfigured(assistantId);
    if (!hasFolder) {
      throw new HttpException({ error: 'no_folder_configured' }, HttpStatus.CONFLICT);
    }
    const n = Math.min(Math.max(parseInt(limit ?? '', 10) || 10, 1), 25);
    const hits = await this.indexedFileService.search(assistantId, q, n);
    return { hits };
  }

  @Get('by-filename')
  async readByFilename(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Query('filename') filename: string,
  ): Promise<ReadWithSyncResult> {
    return this.handleRead(
      await this.indexedFileService.readWithSync(assistantId, { filename: filename ?? '' }),
    );
  }

  @Get(':id/content')
  async readContent(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReadWithSyncResult> {
    return this.handleRead(
      await this.indexedFileService.readWithSync(assistantId, { indexedFileId: id }),
    );
  }

  private handleRead(result: ReadWithSyncResult): ReadWithSyncResult {
    if (result.ok === true) return result;
    const err = (result as { error: string }).error;
    if (err === 'not_found') throw new HttpException(result, HttpStatus.NOT_FOUND);
    if (err === 'ambiguous') throw new HttpException(result, HttpStatus.CONFLICT);
    if (err === 'not_ready') throw new HttpException(result, HttpStatus.ACCEPTED);
    if (err === 'not_extractable') throw new HttpException(result, HttpStatus.UNPROCESSABLE_ENTITY);
    return result;
  }

  @Delete(':id')
  async remove(
    @Param('assistantId', ParseIntPipe) assistantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ deleted: boolean }> {
    await this.indexedFileService.deleteFile(id, assistantId);
    return { deleted: true };
  }

  @Post('reconcile')
  async reconcile(
    @Param('assistantId', ParseIntPipe) assistantId: number,
  ): Promise<ScanFolderResult> {
    return await this.indexedFileService.scanFolder(assistantId);
  }
}
