import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { randomBytes } from 'crypto';
import * as WebSocket from 'ws';
import { AuthService } from '../src/auth/auth.service';
import { UserEntity } from '../src/auth/user.entity';
import { PermissionGroupEntity } from '../src/auth/permission-group.entity';
import { VoiceGateway } from '../src/voice/voice.gateway';
import { VoiceService } from '../src/voice/voice.service';

// Reuse the installed frontend client, like the existing voice smoke test.
// No production dependency, database, model or real credentials are needed.
import { io } from '../../frontend/node_modules/socket.io-client';

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Voice condition timed out');
    await pause(5);
  }
}

describe('Voice authorization and exclusive reservations (simulated worker)', () => {
  let app: INestApplication;
  let worker: HttpServer;
  let wss: WebSocket.Server;
  let jwt: JwtService;
  let url: string;
  let held: Array<() => void>;
  let hold: boolean;
  let upgrades: number;
  let active: number;
  let maximum: number;
  let packets: string[];
  let sockets: any[];
  let users: Map<number, any>;
  let lookup: jest.Mock;
  let config: Record<string, unknown>;

  function connect(token?: unknown, extra: Record<string, unknown> = {}) {
    const socket: any = io(url, {
      transports: ['websocket'],
      forceNew: true,
      autoConnect: false,
      reconnection: false,
      auth: token === undefined ? {} : { token },
      ...extra,
    });
    socket.events = [];
    socket.onAny((event: string, data: any) =>
      socket.events.push({ event, data }),
    );
    socket.on('connect_error', (err: Error) =>
      socket.events.push({ event: 'connect_error', data: err.message }),
    );
    sockets.push(socket);
    socket.connect();
    return socket;
  }
  const count = (s: any, event: string) =>
    s.events.filter((e: any) => e.event === event).length;
  const token = (id = 1, extra = {}) =>
    jwt.sign(
      { sub: id, username: 'user' + id, ...extra },
      'exp' in extra ? {} : { expiresIn: '1h' },
    );
  async function ready(s: any) {
    await until(() => s.connected);
    s.emit('voice:start');
    await until(() => count(s, 'voice:ready') === 1);
  }

  beforeEach(async () => {
    held = [];
    hold = false;
    upgrades = active = maximum = 0;
    packets = [];
    sockets = [];
    users = new Map(
      [1, 2, 3].map((id) => [
        id,
        { id, username: 'user' + id, active: true, permissions: { ask: true } },
      ]),
    );
    lookup = jest.fn(async ({ id }) => users.get(id) ?? null);
    worker = createServer((req, res) => {
      res.writeHead(req.url === '/health' ? 200 : 404);
      res.end();
    });
    wss = new WebSocket.Server({ noServer: true });
    worker.on('upgrade', (req, socket, head) => {
      upgrades++;
      const upgrade = () => {
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit('connection', ws),
        );
      };
      if (hold) held.push(upgrade);
      else upgrade();
    });
    wss.on('connection', (ws) => {
      active++;
      maximum = Math.max(maximum, active);
      ws.once('close', () => {
        active--;
      });
      let text = '';
      ws.on('message', (data, binary) => {
        if (binary) {
          const value = data.toString();
          text += value;
          packets.push(value);
          ws.send(JSON.stringify({ type: 'partial', text, isFinal: false }));
        } else if (JSON.parse(data.toString()).type === 'stop') {
          ws.send(JSON.stringify({ type: 'partial', text, isFinal: true }));
        }
      });
    });
    await new Promise<void>((resolve) =>
      worker.listen(0, '127.0.0.1', resolve),
    );
    config = {
      AUTH_ENABLED: 'true',
      VOICE_WORKER_PORTS: String((worker.address() as AddressInfo).port),
    };
    jwt = new JwtService({ secret: randomBytes(32).toString('hex') });
    const module = await Test.createTestingModule({
      providers: [
        VoiceGateway,
        VoiceService,
        AuthService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        { provide: JwtService, useValue: jwt },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: { findOneBy: lookup },
        },
        { provide: getRepositoryToken(PermissionGroupEntity), useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()) + '/voice';
  });

  afterEach(async () => {
    for (const s of sockets) s.disconnect();
    await app?.close();
    for (const ws of wss.clients) ws.terminate();
    for (const finish of held) finish();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    worker.closeAllConnections();
    await new Promise<void>((resolve) => worker.close(() => resolve()));
  });

  it.each([
    'missing',
    'malformed',
    'wrong-signature',
    'expired',
    'refresh',
    'no-expiry',
    'invalid-subject',
    'unknown',
    'inactive',
    'no-permission',
    'stale-permission',
    'wrong-name',
    'non-boolean-permission',
  ])('rejects %s credentials before contacting a worker', async (kind) => {
    let value: unknown = token();
    if (kind === 'missing') value = undefined;
    if (kind === 'malformed') value = { token: 'not-a-token' };
    if (kind === 'wrong-signature')
      value = new JwtService({ secret: 'fictional-other-key' }).sign({
        sub: 1,
        username: 'user1',
      });
    if (kind === 'expired')
      value = jwt.sign({ sub: 1, username: 'user1', exp: 1 });
    if (kind === 'refresh') value = token(1, { type: 'refresh' });
    if (kind === 'no-expiry') value = jwt.sign({ sub: 1, username: 'user1' });
    if (kind === 'invalid-subject') value = token(1, { sub: '1' });
    if (kind === 'unknown') value = token(9);
    if (kind === 'inactive') users.get(1).active = false;
    if (kind === 'no-permission') users.get(1).permissions = {};
    if (kind === 'stale-permission') {
      value = token(1, { permissions: { ask: true } });
      users.get(1).permissions.ask = false;
    }
    if (kind === 'wrong-name') value = token(1, { username: 'other' });
    if (kind === 'non-boolean-permission')
      users.get(1).permissions.ask = 'true';
    const s = connect(value);
    await until(() => count(s, 'connect_error') === 1);
    s.emit('voice:start');
    await pause();
    expect(upgrades).toBe(0);
    expect(s.events.find((e: any) => e.event === 'connect_error').data).toBe(
      'Voice authorization failed',
    );
  });

  it('fails closed when the current user lookup fails', async () => {
    lookup.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DIAGNOSTIC'));
    const s = connect(token());
    await until(() => count(s, 'connect_error') === 1);
    expect(upgrades).toBe(0);
    expect(s.events.find((e: any) => e.event === 'connect_error').data).toBe(
      'Voice authorization failed',
    );
  });

  it('uses current permissions rather than stale token claims', async () => {
    const s = connect(token(1, { permissions: { ask: false } }));
    await ready(s);
    expect(upgrades).toBe(1);
  });

  it('uses the authorization header accepted by the existing client contract', async () => {
    const s = connect(undefined, {
      extraHeaders: { Authorization: 'Bearer ' + token() },
    });
    await ready(s);
    expect(upgrades).toBe(1);
  });

  it('retains explicit standalone mode without requiring user credentials', async () => {
    config.AUTH_ENABLED = 'false';
    const s = connect();
    await ready(s);
    expect(upgrades).toBe(1);
  });

  it('serializes authorization and audio/control events in their original order', async () => {
    const s = connect(token());
    await ready(s);
    const first = lookup.mockImplementationOnce(async ({ id }) => {
      await pause(40);
      return users.get(id);
    });
    s.emit('voice:chunk', Buffer.from('one'));
    s.emit('voice:chunk', Buffer.from('two'));
    s.emit('voice:stop');
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    expect(packets).toEqual(['one', 'two']);
    expect(
      s.events.filter((e: any) => e.event === 'voice:partial').at(-1).data,
    ).toEqual({ text: 'onetwo', isFinal: true });
    expect(first).toHaveBeenCalled();
  });

  it.each(['inactive', 'permissions', 'deleted'])(
    'releases an open session after %s revocation and rejects its audio',
    async (kind) => {
      const s = connect(token());
      await ready(s);
      if (kind === 'deleted') users.delete(1);
      else if (kind === 'inactive') users.get(1).active = false;
      else users.get(1).permissions.ask = false;
      s.emit('voice:chunk', Buffer.from('forbidden'));
      await until(() => !s.connected && active === 0);
      expect(packets).toEqual([]);
    },
  );

  it('expires an idle connection and releases its worker without another message', async () => {
    const s = connect(token(1, { exp: Math.floor(Date.now() / 1000) + 2 }));
    await ready(s);
    await until(() => !s.connected && active === 0);
  });

  it('reserves a connecting worker once across duplicate starts and concurrent users', async () => {
    hold = true;
    const a = connect(token(1)),
      b = connect(token(2));
    await until(() => a.connected && b.connected);
    a.emit('voice:start');
    a.emit('voice:start');
    b.emit('voice:start');
    await until(() => held.length === 1 && count(b, 'voice:queued') > 0);
    expect(upgrades).toBe(1);
    hold = false;
    held.splice(0).forEach((fn) => fn());
    await until(() => count(a, 'voice:ready') === 1);
    a.emit('voice:chunk', Buffer.from('A'));
    a.emit('voice:stop');
    await until(() => count(b, 'voice:ready') === 1);
    b.emit('voice:chunk', Buffer.from('B'));
    b.emit('voice:stop');
    await until(() =>
      b.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    expect(maximum).toBe(1);
    expect(upgrades).toBe(2);
    expect(
      a.events
        .filter((e: any) => e.event === 'voice:partial')
        .map((e: any) => e.data.text),
    ).toEqual(['A', 'A']);
    expect(
      b.events
        .filter((e: any) => e.event === 'voice:partial')
        .map((e: any) => e.data.text),
    ).toEqual(['B', 'B']);
  });

  it.each(['cancel', 'disconnect'])(
    'releases a pending handshake on %s without a late assignment',
    async (action) => {
      hold = true;
      const a = connect(token(1)),
        b = connect(token(2));
      await until(() => a.connected && b.connected);
      a.emit('voice:start');
      await until(() => held.length === 1);
      b.emit('voice:start');
      await until(() => count(b, 'voice:queued') > 0);
      hold = false;
      if (action === 'cancel') a.emit('voice:cancel');
      else a.disconnect();
      await until(() => count(b, 'voice:ready') === 1);
      held.splice(0).forEach((fn) => fn());
      await pause();
      expect(count(a, 'voice:ready')).toBe(0);
      expect(maximum).toBe(1);
      expect(upgrades).toBe(2);
    },
  );

  it('promotes one queued user at a time and removes cancelled queue entries', async () => {
    const a = connect(token(1)),
      b = connect(token(2)),
      c = connect(token(3));
    await ready(a);
    await until(() => b.connected && c.connected);
    b.emit('voice:start');
    await until(() => count(b, 'voice:queued') > 0);
    c.emit('voice:start');
    await until(() => count(c, 'voice:queued') > 0);
    b.emit('voice:cancel');
    a.emit('voice:stop');
    await until(() => count(c, 'voice:ready') === 1);
    expect(count(b, 'voice:ready')).toBe(0);
    expect(upgrades).toBe(2);
    expect(maximum).toBe(1);
  });

  it('reserves queue promotion before opening a worker for the next user', async () => {
    const a = connect(token(1)),
      b = connect(token(2)),
      c = connect(token(3));
    await ready(a);
    await until(() => b.connected && c.connected);
    b.emit('voice:start');
    await until(() => count(b, 'voice:queued') > 0);
    c.emit('voice:start');
    await until(() => count(c, 'voice:queued') > 0);
    hold = true;
    a.emit('voice:stop');
    await until(() => held.length === 1);
    await pause();
    expect(upgrades).toBe(2);
    expect(count(c, 'voice:ready')).toBe(0);
    hold = false;
    held.splice(0).forEach((fn) => fn());
    await until(() => count(b, 'voice:ready') === 1);
    b.emit('voice:chunk', Buffer.from('B'));
    b.emit('voice:stop');
    await until(() => count(c, 'voice:ready') === 1);
    expect(maximum).toBe(1);
    expect(upgrades).toBe(3);
  });

  it.each(['malformed', 'oversized'])(
    'rejects %s audio without forwarding it',
    async (kind) => {
      const s = connect(token());
      await ready(s);
      s.emit(
        'voice:chunk',
        kind === 'malformed'
          ? { data: 'invalid' }
          : Buffer.alloc(256 * 1024 + 1),
      );
      await until(() => !s.connected && active === 0);
      expect(packets).toEqual([]);
    },
  );

  it('does not promote queued work during shutdown with a pending handshake', async () => {
    hold = true;
    const a = connect(token(1)),
      b = connect(token(2));
    await until(() => a.connected && b.connected);
    a.emit('voice:start');
    await until(() => held.length === 1);
    b.emit('voice:start');
    await until(() => count(b, 'voice:queued') > 0);
    await app.close();
    held.splice(0).forEach((fn) => fn());
    await pause();
    expect(upgrades).toBe(1);
    expect(count(b, 'voice:ready')).toBe(0);
  });

  it('bounds pending authorization work without accepting excess audio', async () => {
    const s = connect(token());
    await ready(s);
    let unblock: () => void;
    lookup.mockImplementationOnce(async ({ id }) => {
      await new Promise<void>((resolve) => {
        unblock = resolve;
      });
      return users.get(id);
    });
    s.emit('voice:chunk', Buffer.from('blocked'));
    await until(() => !!unblock);
    for (let n = 0; n < 40; n++) s.emit('voice:chunk', Buffer.from('excess'));
    await until(() => !s.connected);
    unblock();
    await pause();
    expect(packets).toEqual([]);
  });
});
