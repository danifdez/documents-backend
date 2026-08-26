import {
  Body,
  Controller,
  Delete,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { FeatureFlagService } from '../common/feature-flags.service';
import {
  BrowserWorkerHeartbeatDto,
  EnrollBrowserWorkerDto,
} from './dto/browser-worker.dto';
import { WorkerKind } from './worker-kind.enum';
import { WorkerService } from './worker.service';

@Controller('browser-work')
export class BrowserWorkController {
  constructor(
    private readonly workers: WorkerService,
    private readonly features: FeatureFlagService,
  ) {}

  @Post('enroll')
  async enroll(
    @Body() body: EnrollBrowserWorkerDto,
    @CurrentUser() user: unknown,
  ) {
    this.assertEnabled();
    const { worker, credential } = await this.workers.enrollBrowser(
      body.installationId,
      body.name,
      this.resolveOwnerPrincipal(user),
      body.metadata,
    );
    return {
      workerId: worker.id,
      credential,
      capabilities: worker.capabilities,
      acknowledgedAt: new Date(),
    };
  }

  @Public()
  @Post('heartbeat')
  async heartbeat(
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: BrowserWorkerHeartbeatDto,
  ) {
    this.assertEnabled();
    await this.workers.authenticate(workerId, credential, WorkerKind.BROWSER);
    await this.workers.heartbeatBrowser(workerId, body.metadata);
    return { acknowledgedAt: new Date() };
  }

  @Delete('installations/:installationId')
  async revoke(
    @Param('installationId', new ParseUUIDPipe()) installationId: string,
    @CurrentUser() user: unknown,
  ): Promise<void> {
    this.assertEnabled();
    await this.workers.revokeBrowser(
      installationId,
      this.resolveOwnerPrincipal(user),
    );
  }

  private assertEnabled(): void {
    if (!this.features.isEnabled('browser_federation')) {
      throw new NotFoundException('browser_federation_disabled');
    }
  }

  private resolveOwnerPrincipal(user: unknown): string {
    if (!user || typeof user !== 'object') return 'standalone';
    const record = user as Record<string, unknown>;
    return String(record.userId ?? record.sub ?? 'standalone');
  }
}
