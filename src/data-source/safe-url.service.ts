import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'dns';
import * as net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

@Injectable()
export class SafeUrlService {
  private readonly logger = new Logger(SafeUrlService.name);
  private readonly allowPrivateHosts: boolean;

  constructor(private readonly configService: ConfigService) {
    this.allowPrivateHosts =
      this.configService.get('DATA_SOURCE_ALLOW_PRIVATE_HOSTS') === 'true';
    if (this.allowPrivateHosts) {
      this.logger.warn(
        'DATA_SOURCE_ALLOW_PRIVATE_HOSTS=true — data source URLs may target private networks',
      );
    }
  }

  async assertSafe(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid data source URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Data source URL must use http or https');
    }

    if (this.allowPrivateHosts) return url;

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (this.isBlockedHostname(hostname)) {
      throw new BadRequestException(
        'Data source URL cannot target a private or metadata host',
      );
    }

    const family = net.isIP(hostname);
    let addresses: string[];
    if (family) {
      addresses = [hostname];
    } else {
      try {
        const resolved = await dns.lookup(hostname, {
          all: true,
          verbatim: true,
        });
        addresses = resolved.map((entry) => entry.address);
      } catch {
        throw new BadRequestException('Data source host could not be resolved');
      }
    }

    if (addresses.length === 0) {
      throw new BadRequestException('Data source host could not be resolved');
    }

    for (const address of addresses) {
      if (this.isPrivateAddress(address)) {
        throw new BadRequestException(
          'Data source URL cannot target a private or reserved address',
        );
      }
    }

    return url;
  }

  private isBlockedHostname(hostname: string): boolean {
    if (!hostname) return true;
    if (BLOCKED_HOSTNAMES.has(hostname)) return true;
    if (hostname.endsWith('.localhost')) return true;
    if (hostname.endsWith('.local')) return true;
    if (hostname.endsWith('.internal')) return true;
    return false;
  }

  private isPrivateAddress(address: string): boolean {
    if (net.isIPv4(address)) return this.isPrivateIPv4(address);
    if (net.isIPv6(address)) return this.isPrivateIPv6(address);
    return true;
  }

  private isPrivateIPv4(address: string): boolean {
    const octets = address.split('.').map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
      return true;
    }
    const [a, b, c] = octets;

    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;

    return false;
  }

  private isPrivateIPv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;

    // IPv4-mapped addresses (::ffff:a.b.c.d) inherit the IPv4 policy.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return this.isPrivateIPv4(mapped[1]);

    // IPv4-compatible addresses (::a.b.c.d).
    const compatible = normalized.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (compatible) return this.isPrivateIPv4(compatible[1]);

    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true;
    }
    if (normalized.startsWith('ff')) return true;
    if (normalized.startsWith('2001:db8')) return true;
    if (normalized.startsWith('64:ff9b:')) return true;
    if (normalized.startsWith('100:')) return true;

    return false;
  }
}
