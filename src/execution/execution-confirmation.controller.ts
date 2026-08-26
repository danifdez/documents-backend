import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DecideExecutionConfirmationDto } from './dto/execution-confirmation.dto';
import { ExecutionConfirmationService } from './execution-confirmation.service';
import {
  ExecutionConfirmationEnvelope,
  ExecutionConfirmationView,
} from './execution-confirmation.types';
import { ExecutionService } from './execution.service';

@Controller('execution-confirmations')
export class ExecutionConfirmationController {
  constructor(
    private readonly confirmations: ExecutionConfirmationService,
    private readonly executions: ExecutionService,
  ) {}

  @Get()
  list(@CurrentUser() user: unknown): Promise<ExecutionConfirmationEnvelope[]> {
    return this.confirmations.listPending(
      this.executions.resolveAccessScope(user),
    );
  }

  @Post(':confirmationId/decision')
  decide(
    @Param('confirmationId', new ParseUUIDPipe()) confirmationId: string,
    @Body() dto: DecideExecutionConfirmationDto,
    @CurrentUser() user: unknown,
  ): Promise<ExecutionConfirmationView> {
    return this.confirmations.decide(
      confirmationId,
      dto.decision,
      this.executions.resolveAccessScope(user),
    );
  }
}
