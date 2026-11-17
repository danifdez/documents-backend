import {
  Controller,
  Get,
  Headers,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ExecutionStreamService } from '../execution/execution-stream.service';
import { Permission } from '../auth/permission.enum';

@Controller('voice')
export class VoiceController {
  constructor(
    private readonly records: ExecutionStreamService,
    private readonly auth: AuthService,
  ) {}

  @Get('requests/:requestId')
  async request(
    @Param('requestId') requestId: string,
    @Headers('authorization') header?: string,
  ) {
    let ownerPrincipal = 'standalone';
    if (this.auth.isAuthEnabled()) {
      const { user } = await this.auth.authenticateAccessToken(
        header?.replace(/^Bearer /, ''),
      );
      if (user.permissions?.[Permission.ASK] !== true)
        throw new UnauthorizedException('Voice authorization required');
      ownerPrincipal = String(user.id);
    }
    return this.records.read(requestId, 'voice-dictation', { ownerPrincipal });
  }
}
