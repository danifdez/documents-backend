import { authorizeInferenceCapture } from '../execution/inference-capture';
import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
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
    @Headers('x-evaluation-consent') consent?: string,
  ): Promise<{ executionId: string }> {
    const captureInference = authorizeInferenceCapture(user, consent);
    return this.models.browserInference(
      body,
      this.executions.resolveAccessScope(user),
      captureInference,
    );
  }

  @Get('requests/:requestId')
  @RequirePermissions(Permission.ASK)
  async request(
    @Param('requestId') requestId: string,
    @CurrentUser() user: unknown,
  ) {
    return this.executions.readRequest(
      requestId,
      this.executions.resolveAccessScope(user),
    );
  }

  @Post('requests/:requestId/cancel')
  @RequirePermissions(Permission.ASK)
  async cancelRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: unknown,
  ) {
    return this.executions.cancelRequest(
      requestId,
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
