import {
  Body,
  Controller,
  Delete,
  Headers,
  Get,
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
  ClaimBrowserWorkDto,
  EnrollBrowserWorkerDto,
  RequestBrowserPageReadDto,
} from './dto/browser-worker.dto';
import { ExecutionAttemptService } from '../execution/execution-attempt.service';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import {
  ReceiveExecutionStepResultDto,
  RenewExecutionStepLeaseDto,
} from '../execution/dto/execution-protocol.dto';
import { WorkerKind } from './worker-kind.enum';
import { WorkerService } from './worker.service';

@Controller('browser-work')
export class BrowserWorkController {
  constructor(
    private readonly workers: WorkerService,
    private readonly features: FeatureFlagService,
    private readonly attempts: ExecutionAttemptService,
    private readonly executions: ExecutionService,
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

  @Post('reads')
  async requestPageRead(
    @Body() body: RequestBrowserPageReadDto,
    @CurrentUser() user: unknown,
  ) {
    this.assertEnabled();
    const scope = this.executions.resolveAccessScope(user);
    return this.executions.create(
      'browser-read-current-page',
      ExecutionPriority.NORMAL,
      {
        expectedUrl: body.expectedUrl ?? null,
        maxChars: body.maxChars ?? 20_000,
      },
      {
        ownerPrincipal: scope.ownerPrincipal,
        initialStep: {
          stepKind: ExecutionStepKind.VERIFICATION,
          work: {
            taskType: 'browser-read-current-page',
            payload: {
              expectedUrl: body.expectedUrl ?? null,
              maxChars: body.maxChars ?? 20_000,
            },
          },
          requiredCapabilities: ['browser.read'],
          finalizeOnFailure: true,
        },
      },
    );
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

  @Public()
  @Post('claim')
  async claim(
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: ClaimBrowserWorkDto,
  ) {
    this.assertEnabled();
    const worker = await this.workers.authenticate(
      workerId,
      credential,
      WorkerKind.BROWSER,
    );
    return this.attempts.claimReadyStepWithWait(
      {
        workerId,
        ownerPrincipal: worker.ownerPrincipal ?? undefined,
        stepKinds: [ExecutionStepKind.VERIFICATION],
        capabilities: ['browser.read'],
        leaseDurationMs: body.leaseDurationMs,
        enforceRegisteredWorkerCapacity: true,
      },
      body.waitTimeoutMs,
    );
  }

  @Public()
  @Post('attempts/:attemptId/start')
  async start(
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
  ) {
    this.assertEnabled();
    await this.workers.authenticate(workerId, credential, WorkerKind.BROWSER);
    return this.attempts.startAttempt(attemptId, workerId);
  }

  @Public()
  @Get('attempts/:attemptId/control')
  async control(
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
  ) {
    this.assertEnabled();
    await this.workers.authenticate(workerId, credential, WorkerKind.BROWSER);
    return this.attempts.readAttemptControl(attemptId, workerId);
  }

  @Public()
  @Post('attempts/:attemptId/lease')
  async renewLease(
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: RenewExecutionStepLeaseDto,
  ) {
    this.assertEnabled();
    await this.workers.authenticate(workerId, credential, WorkerKind.BROWSER);
    return this.attempts.renewAttemptLease(
      attemptId,
      workerId,
      body.leaseDurationMs,
    );
  }

  @Public()
  @Post('results')
  async result(
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: ReceiveExecutionStepResultDto,
  ) {
    this.assertEnabled();
    await this.workers.authenticate(workerId, credential, WorkerKind.BROWSER);
    return this.attempts.receiveResult({
      executionId: body.executionId,
      stepId: body.stepId,
      operationId: body.operationId,
      attemptId: body.attemptId,
      workerId,
      result: body as unknown as Record<string, unknown>,
    });
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
