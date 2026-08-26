import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExecutionService } from './execution.service';
import { CancelExecutionDto } from './dto/cancel-execution.dto';

@Controller('executions')
export class ExecutionController {
  constructor(private readonly service: ExecutionService) {}

  @Post(':rootExecutionId/cancel')
  async cancel(
    @Param('rootExecutionId') rootExecutionId: string,
    @Body() input: CancelExecutionDto,
    @CurrentUser() user: unknown,
  ) {
    const scope = this.service.resolveAccessScope(user);
    return this.service.requestCancellation(
      rootExecutionId,
      scope,
      input.reason,
    );
  }

  @Get(':rootExecutionId/events')
  async events(
    @Param('rootExecutionId') rootExecutionId: string,
    @CurrentUser() user: unknown,
    @Query('afterSequence', new ParseIntPipe({ optional: true }))
    afterSequence?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const scope = this.service.resolveAccessScope(user);
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
    @Headers('x-evaluation-consent') evaluationConsent: string | undefined,
  ) {
    const scope = this.service.resolveAccessScope(user);
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
  ) {
    const scope = this.service.resolveAccessScope(user);
    return this.service.readProgress(rootExecutionId, scope);
  }
}
