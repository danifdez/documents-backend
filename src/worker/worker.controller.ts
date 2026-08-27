import { Controller, Delete, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Permission } from '../auth/permission.enum';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WorkerService } from './worker.service';
import { WorkerCredentialEventEntity } from './worker-credential-event.entity';

@Controller('workers')
export class WorkerController {
  constructor(private readonly workers: WorkerService) {}

  @Get(':id/credential-events')
  @RequirePermissions(Permission.USER_MANAGEMENT)
  credentialHistory(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkerCredentialEventEntity[]> {
    return this.workers.credentialHistory(id);
  }

  @Delete(':id/credential')
  @RequirePermissions(Permission.USER_MANAGEMENT)
  revokeCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: unknown,
  ): Promise<void> {
    return this.workers.revokeCredential(id, this.actorPrincipal(user));
  }

  private actorPrincipal(user: unknown): string {
    if (!user || typeof user !== 'object') return 'system';
    const record = user as Record<string, unknown>;
    return String(record.userId ?? record.sub ?? 'system');
  }
}
