import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** How the shared inference engine is announced to clients. */
export interface SharedInference {
  url: string;
}

@Injectable()
export class InferenceService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * The llama-server every part of the system talks to, or null when this
   * installation doesn't share one.
   *
   * There is deliberately no default: a client that finds `inference` in
   * /auth/status shuts down whatever engine it was running and points here
   * instead, so guessing a URL could make it kill the very server it is about
   * to use — the embedded browser starts its own on 127.0.0.1:8080. Sharing an
   * engine is opt-in through LLAMA_SERVER_URL.
   */
  getSharedEngine(): SharedInference | null {
    const raw = (this.configService.get<string>('LLAMA_SERVER_URL') ?? '').trim();
    if (!raw) {
      return null;
    }
    return { url: raw.replace(/\/+$/, '') };
  }
}
