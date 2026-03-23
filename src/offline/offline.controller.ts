import { Controller, Get, Post, Param, Query, Body, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import { OfflineService } from './offline.service';
import { OfflineEnabledGuard } from './guards/offline-enabled.guard';
import { SyncChangeDto } from './dto/sync-change.dto';

@Controller('offline')
@UseGuards(OfflineEnabledGuard)
export class OfflineController {
  constructor(private readonly offlineService: OfflineService) {}

  @Get('bundle/:type/:id')
  async getBundle(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw new BadRequestException('Invalid ID');

    let bundle: any;

    switch (type) {
      case 'resource':
        bundle = await this.offlineService.bundleResource(numId);
        break;
      case 'thread':
        bundle = await this.offlineService.bundleThread(numId);
        break;
      case 'project':
        bundle = await this.offlineService.bundleProject(numId);
        break;
      default:
        throw new BadRequestException(`Invalid bundle type: ${type}. Use resource, thread, or project.`);
    }

    if (!bundle) throw new NotFoundException(`${type} with id ${id} not found`);
    return bundle;
  }

  @Post('sync')
  async sync(@Body() body: { changes: SyncChangeDto[] }) {
    if (!body.changes || !Array.isArray(body.changes)) {
      throw new BadRequestException('Expected { changes: SyncChangeDto[] }');
    }
    return this.offlineService.applySync(body.changes);
  }

  @Get('changes')
  async getChanges(
    @Query('since') since: string,
    @Query('projectId') projectId: string,
  ) {
    if (!since) throw new BadRequestException('Missing "since" query parameter');
    if (!projectId) throw new BadRequestException('Missing "projectId" query parameter');
    return this.offlineService.getChangesSince(since, parseInt(projectId, 10));
  }
}
