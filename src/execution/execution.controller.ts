import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExecutionService } from './execution.service';

@Controller('executions')
export class ExecutionController {
  constructor(private readonly service: ExecutionService) {}

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
    @Headers('x-evaluation-consent') evaluationConsent: string | undefined,
  ) {
    const scope = this.service.resolveAccessScope(user, workspaceId);
    return this.service.exportBundle(
      rootExecutionId,
      scope,
      evaluationConsent === 'granted',
    );
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
}
