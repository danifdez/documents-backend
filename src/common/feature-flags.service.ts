import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FEATURE_FLAGS, FeatureFlag, FeatureMap } from './feature-flags';

@Injectable()
export class FeatureFlagService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(flag: FeatureFlag): boolean {
    const envKey = `FEATURE_${flag.toUpperCase()}`;
    return this.configService.get(envKey) !== 'false';
  }

  getEnabledFeatures(): FeatureMap {
    const result = {} as FeatureMap;
    for (const flag of FEATURE_FLAGS) {
      result[flag] = this.isEnabled(flag);
    }
    return result;
  }
}
