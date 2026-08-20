import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { ExecutionService } from './execution.service';
import { IncomingExecutionArtifact } from './execution.types';
import { CreateExecutionDto } from './dto/execution.dto';
import { ExecutionPriority } from './execution-priority.enum';

@Controller('executions')
export class ExecutionController {
  constructor(
    private readonly service: ExecutionService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @RequirePermissions(Permission.WRITE)
  async create(
    @Body() dto: CreateExecutionDto,
    @CurrentUser() user: unknown,
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ) {
    const scope = this.service.resolveAccessScope(user, workspaceId);
    return this.service.create(
      dto.taskType,
      ExecutionPriority.NORMAL,
      {
        content: dto.content,
        sourceLanguage: dto.sourceLanguage,
        targetLanguage: dto.targetLanguage,
        resourceId: dto.resourceId ? Number(dto.resourceId) : undefined,
      },
      scope,
    );
  }

  @Post('internal/:rootExecutionId/artifacts')
  @Public()
  @SkipThrottle()
  async ingestArtifacts(
    @Param('rootExecutionId') rootExecutionId: string,
    @Headers('x-execution-ingest-token') token: string | undefined,
    @Body() body: { artifacts: IncomingExecutionArtifact[] },
  ) {
    this.assertInternalToken(token);
    return this.service.acceptArtifacts(rootExecutionId, body?.artifacts);
  }

  @Post('internal/:rootExecutionId/events')
  @Public()
  @SkipThrottle()
  async ingestEvents(
    @Param('rootExecutionId') rootExecutionId: string,
    @Headers('x-execution-ingest-token') token: string | undefined,
    @Body() body: { events: Record<string, unknown>[] },
  ) {
    this.assertInternalToken(token);
    return this.service.acceptEvents(rootExecutionId, body?.events);
  }

  @Get(':rootExecutionId/events')
  async events(
    @Param('rootExecutionId') rootExecutionId: string,
    @CurrentUser() user: unknown,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Query('afterSequence', new ParseIntPipe({ optional: true }))
    afterSequence?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const scope = this.service.resolveAccessScope(user, workspaceId);
    return this.service.readEvents(
      rootExecutionId,
      scope,
      afterSequence,
      limit,
    );
  }

  @Get(':rootExecutionId/bundle')
  async bundle(
    @Param('rootExecutionId') rootExecutionId: string,
    @CurrentUser() user: unknown,
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ) {
    const scope = this.service.resolveAccessScope(user, workspaceId);
    return this.service.exportBundle(rootExecutionId, scope);
  }

  @Get(':rootExecutionId/progress')
  async progress(
    @Param('rootExecutionId') rootExecutionId: string,
    @CurrentUser() user: unknown,
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ) {
    const scope = this.service.resolveAccessScope(user, workspaceId);
    return this.service.readProgress(rootExecutionId, scope);
  }

  private assertInternalToken(actual: string | undefined): void {
    const expected = this.config.get<string>('EXECUTION_INGEST_TOKEN') ?? '';
    if (!expected || !actual)
      throw new UnauthorizedException('Invalid internal token');
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('Invalid internal token');
    }
  }
}
