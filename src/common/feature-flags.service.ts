import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FEATURE_FLAGS, FeatureFlag, FeatureMap } from './feature-flags';
import { AppStateService } from '../app-state/app-state.service';

const BROWSER_FEDERATION_KEY = 'browser_federation_enabled';

@Injectable()
export class FeatureFlagService implements OnModuleInit {
  private browserFederationEnabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly appState: AppStateService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.browserFederationEnabled =
      (await this.appState.get(
        BROWSER_FEDERATION_KEY,
        (raw) => raw === 'true',
      )) ?? false;
  }

  async setBrowserFederationEnabled(enabled: boolean): Promise<void> {
    await this.appState.set(BROWSER_FEDERATION_KEY, enabled, String);
    this.browserFederationEnabled = enabled;
  }

  isEnabled(flag: FeatureFlag): boolean {
    if (flag === 'browser_federation') return this.browserFederationEnabled;
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
