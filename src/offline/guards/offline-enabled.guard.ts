import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OfflineEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (this.configService.get('OFFLINE_ENABLED') !== 'true') {
      throw new ForbiddenException('Offline mode is not enabled on this server');
    }
    return true;
  }
}
