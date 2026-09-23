import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { WorkerService } from '../worker/worker.service';
import { FeatureFlagService } from './feature-flags.service';

@Controller('features')
export class FeatureFlagController {
  constructor(
    private readonly features: FeatureFlagService,
    private readonly workers: WorkerService,
  ) {}

  @Get('browser-federation/status')
  async browserFederationStatus(@CurrentUser() user: unknown) {
    const record =
      user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
    const ownerPrincipal = String(record.userId ?? record.sub ?? 'standalone');
    return {
      enabled: this.features.isEnabled('browser_federation'),
      browser: await this.workers.browserTaskStatus(ownerPrincipal),
    };
  }

  @Patch('browser-federation')
  @RequirePermissions(Permission.USER_MANAGEMENT)
  async setBrowserFederation(@Body() body: { enabled?: unknown }) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    await this.features.setBrowserFederationEnabled(body.enabled);
    return { enabled: body.enabled };
  }
}
