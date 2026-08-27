import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { ExecutionService } from '../execution/execution.service';
import { BrowserInferenceDto } from './dto/browser-inference.dto';
import { ModelService } from './model.service';

@Controller('browser-inference')
export class BrowserInferenceController {
  constructor(
    private readonly models: ModelService,
    private readonly executions: ExecutionService,
  ) {}

  @Post()
  @RequirePermissions(Permission.ASK)
  async create(
    @Body() body: BrowserInferenceDto,
    @CurrentUser() user: unknown,
  ): Promise<{ executionId: string }> {
    return this.models.browserInference(
      body,
      this.executions.resolveAccessScope(user),
    );
  }

  @Get(':executionId')
  @RequirePermissions(Permission.ASK)
  async result(
    @Param('executionId') executionId: string,
    @CurrentUser() user: unknown,
  ) {
    return this.executions.readOwnedResult(
      executionId,
      this.executions.resolveAccessScope(user),
    );
  }
}
