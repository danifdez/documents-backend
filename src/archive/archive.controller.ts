import { Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ArchiveService } from './archive.service';

@Controller()
export class ArchiveController {
    constructor(private readonly archiveService: ArchiveService) { }

    @Post('projects/:id/archive')
    async archiveProject(@Param('id', ParseIntPipe) id: number): Promise<{ archived: true }> {
        await this.archiveService.archiveProject(id);
        return { archived: true };
    }

    @Post('projects/:id/unarchive')
    async unarchiveProject(@Param('id', ParseIntPipe) id: number): Promise<{ archived: false }> {
        await this.archiveService.unarchiveProject(id);
        return { archived: false };
    }

    @Post('threads/:id/archive')
    async archiveThread(@Param('id', ParseIntPipe) id: number): Promise<{ archived: true }> {
        await this.archiveService.archiveThread(id);
        return { archived: true };
    }

    @Post('threads/:id/unarchive')
    async unarchiveThread(@Param('id', ParseIntPipe) id: number): Promise<{ archived: false }> {
        await this.archiveService.unarchiveThread(id);
        return { archived: false };
    }
}
