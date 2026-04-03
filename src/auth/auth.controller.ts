import { Controller, Post, Get, Patch, Body, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { FeatureFlagService } from '../common/feature-flags.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  @Public()
  @Get('status')
  getStatus() {
    return {
      authEnabled: this.authService.isAuthEnabled(),
      offlineEnabled: this.authService.isOfflineEnabled(),
      features: this.featureFlagService.getEnabledFeatures(),
    };
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Get('me')
  async getMe(@CurrentUser() user: any) {
    return this.authService.findUserById(user.userId);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    const updated = await this.authService.updateProfile(user.userId, dto);
    if (!updated) {
      throw new UnauthorizedException('User not found');
    }
    return updated;
  }
}
