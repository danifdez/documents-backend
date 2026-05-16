import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { VoiceGateway } from './voice.gateway';
import { VoiceService } from './voice.service';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [VoiceService, VoiceGateway],
  exports: [VoiceService],
})
export class VoiceModule { }
