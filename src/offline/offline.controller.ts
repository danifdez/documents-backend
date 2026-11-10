import { Controller, Get, Post, Param, Query, Body, UseGuards, NotFoundException, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { OfflineService } from './offline.service';
import { OfflineEnabledGuard } from './guards/offline-enabled.guard';
import { ApplySyncDto } from './dto/sync-change.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('offline')
@UseGuards(OfflineEnabledGuard)
export class OfflineController {
  constructor(private readonly offlineService: OfflineService) {}

  // Map (not plain object) so inherited Object.prototype keys never match a user-supplied type
  private readonly bundlersByType = new Map<string, (id: number) => Promise<any>>([
    ['resource', (id) => this.offlineService.bundleResource(id)],
    ['thread', (id) => this.offlineService.bundleThread(id)],
    ['project', (id) => this.offlineService.bundleProject(id)],
  ]);

  @Get('bundle/:type/:id')
  async getBundle(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw new BadRequestException('Invalid ID');

    const bundler = this.bundlersByType.get(type);
    if (!bundler) {
      throw new BadRequestException(`Invalid bundle type: ${type}. Use resource, thread, or project.`);
    }

    const bundle = await bundler(numId);

    if (!bundle) throw new NotFoundException(`${type} with id ${id} not found`);
    return bundle;
  }

  @Post('sync')
  @RequirePermissions(Permission.WRITE)
  async sync(@Body() body: ApplySyncDto) {
    if (!body.changes || !Array.isArray(body.changes)) {
      throw new BadRequestException('Expected { changes: SyncChangeDto[] }');
    }
    if (body.changes.length > 500) {
      throw new BadRequestException('Too many changes in one sync (max 500)');
    }
    return this.offlineService.applySync(body.changes);
  }

  @Get('changes')
  async getChanges(
    @Query('since') since: string,
    @Query('projectId', ParseIntPipe) projectId: number,
  ) {
    if (!since) throw new BadRequestException('Missing "since" query parameter');
    if (Number.isNaN(new Date(since).getTime())) {
      throw new BadRequestException('Invalid "since" query parameter');
    }
    return this.offlineService.getChangesSince(since, projectId);
  }
}
