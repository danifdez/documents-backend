import { ConfigService } from '@nestjs/config';
import { AppStateService } from '../../../src/app-state/app-state.service';
import { FeatureFlagService } from '../../../src/common/feature-flags.service';

describe('FeatureFlagService', () => {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  it('changes browser availability through the saved setting', async () => {
    const appState = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as AppStateService;
    const service = new FeatureFlagService(config, appState);

    await service.onModuleInit();
    expect(service.isEnabled('browser_federation')).toBe(false);
    expect(service.isEnabled('canvas')).toBe(true);

    await service.setBrowserFederationEnabled(true);
    expect(service.isEnabled('browser_federation')).toBe(true);
    expect(appState.set).toHaveBeenCalledWith(
      'browser_federation_enabled',
      true,
      String,
    );

    await service.setBrowserFederationEnabled(false);
    expect(service.isEnabled('browser_federation')).toBe(false);
  });

  it('restores the browser setting on startup', async () => {
    const appState = {
      get: jest.fn().mockResolvedValue(true),
    } as unknown as AppStateService;
    const service = new FeatureFlagService(config, appState);
    await service.onModuleInit();
    expect(service.isEnabled('browser_federation')).toBe(true);
  });
});
