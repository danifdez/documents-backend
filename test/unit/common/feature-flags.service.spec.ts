import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from '../../../src/common/feature-flags.service';

describe('FeatureFlagService', () => {
  it('keeps browser federation disabled unless explicitly enabled', () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const service = new FeatureFlagService(config as unknown as ConfigService);

    expect(service.isEnabled('browser_federation')).toBe(false);
    expect(service.isEnabled('canvas')).toBe(true);
  });

  it('enables browser federation only for the exact true value', () => {
    const enabled = new FeatureFlagService({
      get: jest.fn().mockReturnValue('true'),
    } as unknown as ConfigService);
    const uppercase = new FeatureFlagService({
      get: jest.fn().mockReturnValue('TRUE'),
    } as unknown as ConfigService);

    expect(enabled.isEnabled('browser_federation')).toBe(true);
    expect(uppercase.isEnabled('browser_federation')).toBe(false);
  });
});
