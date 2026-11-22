import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'node:dns';
import * as net from 'node:net';

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
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
      return true;
    }
    const [a, b, c] = octets;

    switch (a) {
      case 0:
      case 10:
      case 127:
        return true;
      case 100:
        return b >= 64 && b <= 127;
      case 169:
        return b === 254;
      case 172:
        return b >= 16 && b <= 31;
      case 192:
        return b === 168 || (b === 0 && (c === 0 || c === 2));
      case 198:
        return b === 18 || b === 19 || (b === 51 && c === 100);
      case 203:
        return b === 0 && c === 113;
      default:
        return a >= 224;
    }
  }

  private isPrivateIPv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;

    // IPv4-mapped addresses (::ffff:a.b.c.d) inherit the IPv4 policy.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped) return this.isPrivateIPv4(mapped[1]);

    // IPv4-compatible addresses (::a.b.c.d).
    const compatible = /^::(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
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
