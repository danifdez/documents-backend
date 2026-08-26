import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WorkerService } from '../worker/worker.service';
import { WorkerKind } from '../worker/worker-kind.enum';
import {
  ClaimExecutionStepDto,
  ModelsWorkerHeartbeatDto,
  ReceiveExecutionStepResultDto,
  RegisterModelsWorkerDto,
  RenewExecutionStepLeaseDto,
  UploadExecutionOutputArtifactDto,
} from './dto/execution-protocol.dto';
import { ExecutionAttemptService } from './execution-attempt.service';

@Controller('models-work')
@Public()
export class ExecutionProtocolController {
  constructor(
    private readonly attempts: ExecutionAttemptService,
    private readonly workers: WorkerService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Headers('x-models-enrollment-token') enrollmentToken: string | undefined,
    @Body() body: RegisterModelsWorkerDto,
  ) {
    this.assertEnrollmentToken(enrollmentToken);
    const { worker, credential } = await this.workers.registerModels(
      body.workerId,
      body.name,
      body.capabilities,
      body.stepKinds,
      body.maximumConcurrency,
      body.metadata,
    );
    return { workerId: worker.id, credential };
  }

  @Post('heartbeat')
  async heartbeat(
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: ModelsWorkerHeartbeatDto,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    await this.workers.heartbeatModels(
      workerId,
      body.capabilities,
      body.stepKinds,
      body.maximumConcurrency,
      body.metadata,
    );
    return { acknowledgedAt: new Date() };
  }

  @Post('claim')
  async claim(
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: ClaimExecutionStepDto,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    const { waitTimeoutMs, ...claim } = body;
    return this.attempts.claimReadyStepWithWait(
      {
        workerId,
        ...claim,
        enforceRegisteredWorkerCapacity: true,
      },
      waitTimeoutMs,
    );
  }

  @Post('attempts/:attemptId/start')
  async start(
    @Param('attemptId') attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    return this.attempts.startAttempt(attemptId, workerId);
  }

  @Post('attempts/:attemptId/lease')
  async renewLease(
    @Param('attemptId') attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: RenewExecutionStepLeaseDto,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    return this.attempts.renewAttemptLease(
      attemptId,
      workerId,
      body.leaseDurationMs,
    );
  }

  @Get('attempts/:attemptId/control')
  async control(
    @Param('attemptId') attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    return this.attempts.readAttemptControl(attemptId, workerId);
  }

  @Get('attempts/:attemptId/artifacts/:artifactId')
  async artifact(
    @Param('attemptId') attemptId: string,
    @Param('artifactId') artifactId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    const artifact = await this.attempts.getInputArtifact(
      attemptId,
      workerId,
      artifactId,
    );
    response.setHeader('content-type', artifact.mediaType);
    response.setHeader('content-length', artifact.size);
    response.setHeader('etag', `"${artifact.contentHash}"`);
    return new StreamableFile(artifact.body!);
  }

  @Post('results')
  async result(
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: ReceiveExecutionStepResultDto,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    return this.attempts.receiveResult({
      executionId: body.executionId,
      stepId: body.stepId,
      operationId: body.operationId,
      attemptId: body.attemptId,
      workerId,
      result: body as unknown as Record<string, unknown>,
    });
  }

  @Post('attempts/:attemptId/artifacts')
  async uploadArtifact(
    @Param('attemptId') attemptId: string,
    @Headers('x-worker-id') workerId: string,
    @Headers('x-worker-credential') credential: string | undefined,
    @Body() body: UploadExecutionOutputArtifactDto,
  ) {
    await this.workers.authenticate(workerId, credential, WorkerKind.MODELS);
    return this.attempts.uploadOutputArtifact(attemptId, workerId, {
      ...body,
      encoding: 'identity',
      dataClassification: 'workspace',
      redaction: { applied: false },
      retentionClass: 'execution',
      inputSourceIds: [],
    });
  }

  private assertEnrollmentToken(actual: string | undefined): void {
    const expected = this.config.get<string>('MODELS_ENROLLMENT_TOKEN') ?? '';
    if (!expected || !actual) {
      throw new UnauthorizedException('invalid_models_enrollment_token');
    }
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('invalid_models_enrollment_token');
    }
  }
}
