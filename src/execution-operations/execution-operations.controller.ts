import { Body, Controller, Get, Post } from '@nestjs/common';
import { Permission } from '../auth/permission.enum';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { ReconcileExecutionOperationsDto } from './dto/reconcile-execution-operations.dto';
import { ExecutionOperationsService } from './execution-operations.service';

@Controller('execution-operations')
@RequirePermissions(Permission.USER_MANAGEMENT)
export class ExecutionOperationsController {
  constructor(private readonly operations: ExecutionOperationsService) {}

  @Get()
  snapshot() {
    return this.operations.snapshot();
  }

  @Post('reconcile')
  reconcile(@Body() request: ReconcileExecutionOperationsDto) {
    return this.operations.reconcile(request.limit);
  }
}
