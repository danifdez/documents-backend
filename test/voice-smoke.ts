/* Smoke test for VoiceGateway with worker pool (Task 07).
 *
 * Starts a minimal Nest with only VoiceModule and a pool already running,
 * and validates:
 *   1) happy path: start → ready → stop → partial(final).
 *   2) Queue with pool=1: 2 simultaneous clients; the 2nd receives
 *      voice:queued and then voice:assigned when the 1st finishes.
 *   3) Cancel while queued releases the client and the next session advances.
 *   4) Disconnect of the client holding a worker → releases the slot.
 *
 * Requires the Python workers to be running. If VOICE_WORKER_PORTS is not
 * defined, uses the defaults (127.0.0.1:9100). To test the queue, pool=1 is
 * assumed.
 *
 * Run: node -r ts-node/register -r tsconfig-paths/register test/voice-smoke.ts
 */
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
// socket.io-client is not in the backend; we take it from the frontend
// to avoid adding a runtime dependency to the backend.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { io } = require('../../frontend/node_modules/socket.io-client');
type Socket = any;
import { VoiceGateway } from '../src/voice/voice.gateway';
import { VoiceService } from '../src/voice/voice.service';

@Module({
  imports: [
    ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
    JwtModule.register({ secret: 'smoke' }),
  ],
  providers: [VoiceService, VoiceGateway],
})
class SmokeAppModule { }

function wait<T>(socket: Socket, evt: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${evt}`)), timeoutMs);
    socket.once(evt, (payload: T) => { clearTimeout(t); resolve(payload); });
  });
}

function connect(url: string): Promise<Socket> {
  const s: Socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

async function main() {
  process.env.CORS_ORIGIN = 'http://localhost';
  process.env.AUTH_ENABLED = 'false';
  if (!process.env.VOICE_WORKER_PORTS && !process.env.VOICE_WORKER_POOL_SIZE) {
    process.env.VOICE_WORKER_POOL_SIZE = '1';
  }

  const app = await NestFactory.create(SmokeAppModule, { logger: ['warn', 'error'] });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(3099);
  console.log('NestJS up on :3099 (pool size from env)');

  const base = 'http://localhost:3099/voice';

  try {
    // ── 1) Happy path ──
    const c1 = await connect(base);
    c1.emit('voice:start');
    await wait(c1, 'voice:ready');
    console.log('1) S1 ready');
    c1.emit('voice:stop');
    const final = await wait<{ text: string; isFinal: boolean }>(c1, 'voice:partial', 5000);
    if (!final.isFinal) throw new Error('expected isFinal=true');
    console.log('1) S1 final OK');
    c1.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    // ── 2) Queue: pool=1 + 2 clients ──
    const a = await connect(base);
    const b = await connect(base);
    a.emit('voice:start');
    await wait(a, 'voice:ready');
    console.log('2) A ready');
    b.emit('voice:start');
    const queued = await wait<{ position: number; eta: number }>(b, 'voice:queued', 2000);
    if (queued.position !== 1) throw new Error(`expected position=1, got ${queued.position}`);
    console.log('2) B queued', queued);
    // A finishes → B is promoted
    a.emit('voice:stop');
    await wait(a, 'voice:partial', 5000);
    await wait(b, 'voice:assigned', 5000);
    console.log('2) B assigned after A finished');
    b.emit('voice:stop');
    await wait(b, 'voice:partial', 5000);
    console.log('2) B final OK');
    a.disconnect();
    b.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    // ── 3) Cancel while queued ──
    const x = await connect(base);
    const y = await connect(base);
    const z = await connect(base);
    x.emit('voice:start');
    await wait(x, 'voice:ready');
    y.emit('voice:start');
    await wait(y, 'voice:queued');
    z.emit('voice:start');
    const zq = await wait<{ position: number }>(z, 'voice:queued');
    console.log('3) z queued at', zq.position);
    // y cancels → z should move to position 1
    y.emit('voice:cancel');
    const zq2 = await wait<{ position: number }>(z, 'voice:queued', 2000);
    if (zq2.position !== 1) throw new Error(`after y cancel, expected z position=1, got ${zq2.position}`);
    console.log('3) z promoted to position 1 after y cancelled');
    // x finishes → z assigned
    x.emit('voice:stop');
    await wait(x, 'voice:partial');
    await wait(z, 'voice:assigned');
    console.log('3) z assigned');
    z.emit('voice:stop');
    await wait(z, 'voice:partial');
    x.disconnect();
    y.disconnect();
    z.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    // ── 4) Disconnect releases slot ──
    const p = await connect(base);
    p.emit('voice:start');
    await wait(p, 'voice:ready');
    p.disconnect();
    await new Promise((r) => setTimeout(r, 300));
    const q = await connect(base);
    q.emit('voice:start');
    await wait(q, 'voice:ready', 2000);
    console.log('4) slot released after disconnect');
    q.disconnect();

    console.log('\nALL OK');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
