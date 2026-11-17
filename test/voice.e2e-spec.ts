import { ExecutionController } from '../src/execution/execution.controller';
import { stat } from 'fs/promises';
import { join } from 'path';
import { ExecutionArtifactEntity } from '../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../src/execution/execution-contract-validator';
import { contentHash } from '../src/execution/execution-canonical';
import { ExecutionArtifactStorageService } from '../src/execution/execution-artifact-storage.service';
import { ExecutionRequestEntity } from '../src/execution/execution-request.entity';
import { CreateExecutionRequests1794800000000 } from '../migrations/1794800000000-CreateExecutionRequests';
import { createExecutionFixture } from './execution/fixture';
import { ExecutionStreamService } from '../src/execution/execution-stream.service';
import { ExecutionService } from '../src/execution/execution.service';
import { VoiceController } from '../src/voice/voice.controller';
import { ExecutionEntity } from '../src/execution/execution.entity';
import { ExecutionEventEntity } from '../src/execution/execution-event.entity';
import { ExecutionStepEntity } from '../src/execution/execution-step.entity';
import { ExecutionStatus } from '../src/execution/execution-status.enum';
import { DataSource } from 'typeorm';
import { request as httpRequest } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { randomBytes, randomUUID } from 'crypto';
import * as WebSocket from 'ws';
import { AuthService } from '../src/auth/auth.service';
import { UserEntity } from '../src/auth/user.entity';
import { PermissionGroupEntity } from '../src/auth/permission-group.entity';
import { VoiceGateway } from '../src/voice/voice.gateway';
import { VoiceService } from '../src/voice/voice.service';

// Reuse the installed frontend client, like the existing voice smoke test.
// No production dependency, model or real credentials are needed.
// Durable records use the existing fixture in an isolated PostgreSQL schema.
import { io } from '../../frontend/node_modules/socket.io-client';

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean | Promise<boolean>) {
  const end = Date.now() + 3000;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error('Voice condition timed out');
    await pause(5);
  }
}

describe('Voice authorization, reservations and durable recovery (simulated worker)', () => {
  const fixture = createExecutionFixture({
    entities: [ExecutionRequestEntity],
    prepare: async (runner) => {
      if (!(await runner.hasTable('execution_requests'))) {
        await new CreateExecutionRequests1794800000000().up(runner);
      }
    },
  });
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
  let workerInput: Buffer[];
  let simulatedTranscript: string | undefined;
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
    await fixture().dataSource.getRepository(ExecutionRequestEntity).clear();
    held = [];
    hold = false;
    upgrades = active = maximum = 0;
    packets = [];
    workerInput = [];
    simulatedTranscript = undefined;
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
          text = simulatedTranscript ?? text + value;
          packets.push(value);
          workerInput.push(Buffer.from(data as Buffer));
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
      controllers: [VoiceController, ExecutionController],
      providers: [
        { provide: DataSource, useValue: fixture().dataSource },
        { provide: ExecutionService, useValue: fixture().service },
        ExecutionStreamService,
        {
          provide: ExecutionArtifactStorageService,
          useValue: new ExecutionArtifactStorageService({
            get: (key: string) =>
              key === 'EXECUTION_ARTIFACT_STORAGE_DIR'
                ? fixture().artifactDirectory
                : key === 'EXECUTION_ARTIFACT_INLINE_MAX_BYTES'
                  ? '0'
                  : undefined,
          } as ConfigService),
        },
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
    await until(() => held.length === 1);
    b.emit('voice:start');
    await until(() => count(b, 'voice:queued') > 0);
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

  const receipt = (s: any) =>
    s.events.find((e: any) => e.event === 'voice:accepted')?.data;
  const scope = { ownerPrincipal: '1' };
  async function start(s: any, id: string) {
    await until(() => s.connected);
    s.emit('voice:start', { requestId: id });
    await until(() => !!receipt(s));
    return receipt(s);
  }
  async function readRequest(id: string, idToken = token()) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = httpRequest(
        url.replace(/\/voice$/, '') + '/voice/requests/' + id,
        { headers: { Authorization: 'Bearer ' + idToken } },
        (res) => {
          let raw = '';
          res.on('data', (b) => (raw += b.toString()));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: JSON.parse(raw) }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('recovers a lost acceptance without a second worker', async () => {
    const id = randomUUID(),
      s = connect(token());
    await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    const first = receipt(s);
    s.events = s.events.filter((e: any) => e.event !== 'voice:accepted');
    s.emit('voice:start', { requestId: id });
    await until(() => !!receipt(s));
    expect(receipt(s).executionId).toBe(first.executionId);
    expect(upgrades).toBe(1);
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(1);
  });

  it('deduplicates sockets sharing one request', async () => {
    const id = randomUUID(),
      a = connect(token()),
      b = connect(token());
    await until(() => a.connected && b.connected);
    a.emit('voice:start', { requestId: id });
    b.emit('voice:start', { requestId: id });
    await until(() => !!receipt(a) && !!receipt(b));
    await until(() => count(a, 'voice:ready') + count(b, 'voice:ready') === 1);
    expect(receipt(a).executionId).toBe(receipt(b).executionId);
    expect(upgrades).toBe(1);
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(1);
  });

  it('recovers a lost final through HTTP without duplicate work', async () => {
    const id = randomUUID(),
      s = connect(token());
    const accepted = await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    s.emit('voice:chunk', Buffer.from('preserved'));
    s.emit('voice:stop');
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    s.disconnect();
    await until(() => active === 0);
    const ds = fixture().dataSource,
      events = ds.getRepository(ExecutionEventEntity);
    const before = await events.count();
    const reader = new ExecutionStreamService(
      ds,
      fixture().service,
      app.get(ExecutionArtifactStorageService),
    );
    for (let n = 0; n < 3; n++) {
      const state = await readRequest(id);
      expect(state.status).toBe(200);
      expect(state.body.executionId).toBe(accepted.executionId);
      expect(state.body.result).toMatchObject({
        text: 'preserved',
        chunks: 1,
        audioBytes: 9,
      });
      expect((await reader.read(id, 'voice-dictation', scope)).status).toBe(
        'completed',
      );
    }
    const reconnect = connect(token());
    await start(reconnect, id);
    await pause();
    expect(count(reconnect, 'voice:ready')).toBe(0);
    expect(upgrades).toBe(1);
    expect(await events.count()).toBe(before);
    expect(await ds.getRepository(ExecutionEntity).count()).toBe(1);
    expect(await ds.getRepository(ExecutionStepEntity).count()).toBe(0);
    const bundle = await fixture().service.exportBundle(
      accepted.executionId,
      scope,
      true,
    );
    expect(
      (bundle.bundleCompleteness as { missing: string[] }).missing,
    ).toEqual(
      expect.arrayContaining([
        'stream.input_not_captured',
        'stream.engine_not_reported',
      ]),
    );
    expect(
      await fixture().service.readEvents(accepted.executionId, scope),
    ).toMatchObject({ hasMore: false });
  });

  it('enforces HTTP ownership, authentication and export consent', async () => {
    const id = randomUUID(),
      s = connect(token());
    const accepted = await start(s, id);
    expect((await readRequest(id, token(2))).status).toBe(404);
    expect((await readRequest(id, 'invalid')).status).toBe(401);
    users.get(1).permissions.ask = false;
    expect((await readRequest(id)).status).toBe(401);
    await expect(
      fixture().service.exportBundle(
        accepted.executionId,
        { ownerPrincipal: '2' },
        true,
      ),
    ).rejects.toThrow();
    await expect(
      fixture().service.exportBundle(accepted.executionId, scope, false),
    ).rejects.toThrow();
  });

  it('keeps separate owned executions when two users choose the same UUID', async () => {
    const id = randomUUID(),
      a = connect(token()),
      b = connect(token(2));
    const first = await start(a, id),
      second = await start(b, id);
    expect(first.executionId).not.toBe(second.executionId);
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(2);
    expect((await readRequest(id, token(2))).body.executionId).toBe(
      second.executionId,
    );
  });

  it('records disconnect without replay on reconnect', async () => {
    const id = randomUUID(),
      s = connect(token());
    await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    s.disconnect();
    await until(() => active === 0);
    await until(() => !s.connected);
    const records = app.get(ExecutionStreamService);
    for (let n = 0; n < 30; n++) {
      if (
        (await records.read(id, 'voice-dictation', scope)).status === 'failed'
      )
        break;
      await pause();
    }
    expect((await records.read(id, 'voice-dictation', scope)).status).toBe(
      'failed',
    );
    const s2 = connect(token());
    await start(s2, id);
    await pause();
    expect(count(s2, 'voice:ready')).toBe(0);
    expect(upgrades).toBe(1);
  });

  it('keeps cancellation terminal despite a late final', async () => {
    const id = randomUUID(),
      s = connect(token());
    const accepted = await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    s.emit('voice:cancel');
    await until(() => active === 0);
    const records = app.get(ExecutionStreamService);
    const state = await records.read(id, 'voice-dictation', scope);
    expect(state.status).toBe('cancelled');
    const before = await fixture()
      .dataSource.getRepository(ExecutionEventEntity)
      .count();
    await records.record(
      accepted.executionId,
      'voice-dictation',
      scope,
      ExecutionStatus.COMPLETED,
      'voice_final',
      { text: 'late' },
    );
    expect((await records.read(id, 'voice-dictation', scope)).status).toBe(
      'cancelled',
    );
    expect(
      await fixture().dataSource.getRepository(ExecutionEventEntity).count(),
    ).toBe(before);
  });

  it('honors common execution cancellation before forwarding more audio', async () => {
    const id = randomUUID(),
      s = connect(token());
    const accepted = await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    await fixture().service.requestCancellation(accepted.executionId, scope);
    s.emit('voice:chunk', Buffer.from('must-not-run'));
    await until(() => active === 0);
    expect(packets).toEqual([]);
    expect((await readRequest(id)).body.status).toBe('cancelled');
  });

  it('does not allow another task to reuse a voice request identity', async () => {
    const id = randomUUID(),
      s = connect(token());
    await start(s, id);
    const records = app.get(ExecutionStreamService);
    await expect(
      records.open('voice-dictation', { requestId: randomUUID() }, id, scope),
    ).rejects.toThrow();
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(1);
  });

  it('keeps a persisted final when its database confirmation is lost', async () => {
    const id = randomUUID(),
      s = connect(token());
    const accepted = await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    const records = app.get(ExecutionStreamService),
      original = records.record.bind(records);
    let lost = false;
    const fault = jest
      .spyOn(records, 'record')
      .mockImplementation(
        async (...args: Parameters<ExecutionStreamService['record']>) => {
          const row = await original(...args);
          if (args[3] === ExecutionStatus.COMPLETED && !lost) {
            lost = true;
            throw new Error('Simulated lost commit confirmation');
          }
          return row;
        },
      );
    s.emit('voice:chunk', Buffer.from('confirmed'));
    s.emit('voice:stop');
    await until(() => lost && active === 0);
    expect(
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    ).toBe(false);
    const state = await readRequest(id);
    expect(state.body).toMatchObject({
      executionId: accepted.executionId,
      status: 'completed',
      result: { text: 'confirmed' },
    });
    const before = await fixture()
      .dataSource.getRepository(ExecutionEventEntity)
      .count();
    for (let n = 0; n < 3; n++)
      expect((await readRequest(id)).body.status).toBe('completed');
    expect(
      await fixture().dataSource.getRepository(ExecutionEventEntity).count(),
    ).toBe(before);
    expect(upgrades).toBe(1);
    fault.mockRestore();
  });

  it('persists the final before handling the immediate worker close', async () => {
    const id = randomUUID(),
      s = connect(token());
    await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    const ws = [...wss.clients][0];
    ws.send(
      JSON.stringify({
        type: 'partial',
        text: 'final-before-close',
        isFinal: true,
      }),
    );
    ws.close();
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    expect((await readRequest(id)).body).toMatchObject({
      status: 'completed',
      result: { text: 'final-before-close' },
    });
    expect(upgrades).toBe(1);
  });

  it('does not create new events when the same terminal publication is repeated', async () => {
    const id = randomUUID(),
      s = connect(token());
    const accepted = await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    s.emit('voice:stop');
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    const records = app.get(ExecutionStreamService),
      state = await records.read(id, 'voice-dictation', scope);
    const before = await fixture()
      .dataSource.getRepository(ExecutionEventEntity)
      .count();
    for (let n = 0; n < 3; n++)
      await records.record(
        accepted.executionId,
        'voice-dictation',
        scope,
        ExecutionStatus.COMPLETED,
        'voice_final',
        state.result as Record<string, unknown>,
      );
    expect(
      await fixture().dataSource.getRepository(ExecutionEventEntity).count(),
    ).toBe(before);
    await expect(
      records.record(
        accepted.executionId,
        'voice-dictation',
        scope,
        ExecutionStatus.COMPLETED,
        'voice_final',
        { text: 'different' },
      ),
    ).rejects.toThrow();
  });

  it('records worker failure without exposing its private diagnostic', async () => {
    const id = randomUUID(),
      s = connect(token());
    await start(s, id);
    await until(() => count(s, 'voice:ready') === 1);
    [...wss.clients][0].send(
      JSON.stringify({ type: 'error', message: 'PRIVATE_WORKER_DETAILS' }),
    );
    await until(() => active === 0);
    const state = await readRequest(id);
    expect(state.body.status).toBe('failed');
    expect(JSON.stringify(state.body)).not.toContain('PRIVATE_WORKER_DETAILS');
    expect(
      s.events.some(
        (e: any) =>
          e.event === 'voice:error' && e.data.message === 'Voice worker failed',
      ),
    ).toBe(true);
    expect(upgrades).toBe(1);
  });

  it('reports a safe start error before disconnecting if persistence fails', async () => {
    const s = connect(token());
    await until(() => s.connected);
    const records = app.get(ExecutionStreamService);
    const fault = jest
      .spyOn(records, 'open')
      .mockRejectedValueOnce(new Error('PRIVATE_STORAGE_DIAGNOSTIC'));
    s.emit('voice:start', { requestId: randomUUID() });
    await until(() => !s.connected);
    expect(
      s.events.some(
        (e: any) =>
          e.event === 'voice:error' &&
          e.data.message === 'Voice session is unavailable',
      ),
    ).toBe(true);
    expect(upgrades).toBe(0);
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(0);
    fault.mockRestore();
  });

  it('rejects extra fields in voice start requests', async () => {
    const s = connect(token());
    await until(() => s.connected);
    s.emit('voice:start', { requestId: randomUUID(), ownerPrincipal: 'other' });
    await until(() => !s.connected);
    expect(upgrades).toBe(0);
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(0);
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

  function captureSocket(id = 1) {
    simulatedTranscript = 'Simulated dictation';
    users.get(id).permissions.export = true;
    return connect(token(id), {
      extraHeaders: { 'X-Evaluation-Consent': 'granted' },
    });
  }

  async function startCapture(
    s: any,
    id = randomUUID(),
    mediaType = 'audio/wav',
  ) {
    await until(() => s.connected);
    s.emit('voice:start', { requestId: id, mediaType });
    await until(() => !!receipt(s) && count(s, 'voice:ready') === 1);
    return { id, ...receipt(s) };
  }

  function silenceWav(audioBytes = 320) {
    const body = Buffer.alloc(44 + audioBytes);
    body.write('RIFF', 0);
    body.writeUInt32LE(body.length - 8, 4);
    body.write('WAVEfmt ', 8);
    body.writeUInt32LE(16, 16);
    body.writeUInt16LE(1, 20);
    body.writeUInt16LE(1, 22);
    body.writeUInt32LE(16000, 24);
    body.writeUInt32LE(32000, 28);
    body.writeUInt16LE(2, 32);
    body.writeUInt16LE(16, 34);
    body.write('data', 36);
    body.writeUInt32LE(audioBytes, 40);
    return body;
  }

  const inputRows = () =>
    fixture()
      .dataSource.getRepository(ExecutionArtifactEntity)
      .find({ where: { kind: 'stream_input' }, order: { createdAt: 'ASC' } });

  it.each([
    'missing-export',
    'stale-export',
    'non-boolean-export',
    'standalone',
  ])('rejects capture with %s before opening a worker', async (kind) => {
    if (kind === 'standalone') config.AUTH_ENABLED = 'false';
    if (kind === 'non-boolean-export') users.get(1).permissions.export = 'true';
    const s = connect(token(1, { permissions: { ask: true, export: true } }), {
      extraHeaders: { 'X-Evaluation-Consent': 'granted' },
    });
    await until(() => count(s, 'connect_error') === 1);
    expect(upgrades).toBe(0);
    expect(await inputRows()).toHaveLength(0);
  });

  it('keeps capture disabled without consent despite export permission and format', async () => {
    users.get(1).permissions.export = true;
    const s = connect(token());
    await until(() => s.connected);
    s.emit('voice:start', { requestId: randomUUID(), mediaType: 'audio/wav' });
    await until(() => count(s, 'voice:ready') === 1);
    s.emit('voice:chunk', silenceWav());
    await until(() => workerInput.length === 1);
    expect(await inputRows()).toHaveLength(0);
  });

  it.each([undefined, 'text/html', 'audio/wav;filename=../../private'])(
    'rejects a capture without a permitted media type: %s',
    async (mediaType) => {
      const s = captureSocket();
      await until(() => s.connected);
      s.emit('voice:start', { requestId: randomUUID(), mediaType });
      await until(() => !s.connected);
      expect(upgrades).toBe(0);
      expect(await inputRows()).toHaveLength(0);
    },
  );

  it('does not accept capture consent from the start body', async () => {
    users.get(1).permissions.export = true;
    const s = connect(token());
    await until(() => s.connected);
    s.emit('voice:start', {
      requestId: randomUUID(),
      captureInput: true,
      mediaType: 'audio/wav',
    });
    await until(() => !s.connected);
    expect(upgrades).toBe(0);
  });

  it('preserves ordered audio in the common bundle without replay', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    const wav = silenceWav(640);
    const chunks = [
      wav.subarray(0, 44),
      wav.subarray(44, 364),
      wav.subarray(364),
    ];
    for (const chunk of chunks) s.emit('voice:chunk', chunk);
    s.emit('voice:stop');
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    expect(workerInput).toEqual(chunks);
    const rows = await inputRows();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.artifactId)).size).toBe(3);
    expect(rows.map((row) => row.contentHash)).toEqual(chunks.map(contentHash));
    const validator = new ExecutionContractValidator();
    const first = await fixture().service.exportBundle(
      accepted.executionId,
      scope,
      true,
    );
    validator.assertBundle(first);
    const sources = (first.events as any[]).filter(
      (event) => event.eventType === 'source.observed',
    );
    expect(sources).toHaveLength(3);
    sources.forEach((event, index) => {
      validator.assertEvent(event);
      expect(event.payload.metadata).toMatchObject({
        streamInputSequence: index + 1,
        mediaType: 'audio/wav',
        mediaTypeVerification: 'client_declared',
        delivery: 'received_before_forwarding',
      });
      expect(event.artifactRefs).toEqual([event.payload.snapshotArtifactId]);
    });
    const embedded = first.embeddedArtifacts as Record<
      string,
      { data: string }
    >;
    const restored = sources.map((event) =>
      Buffer.from(embedded[event.payload.snapshotArtifactId].data, 'base64'),
    );
    expect(restored).toEqual(workerInput);
    for (const row of rows) {
      expect(row).toMatchObject({
        dataClassification: 'sensitive',
        retentionClass: 'evaluation',
        redaction: { applied: false, authorizedCapture: true },
      });
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(row.storageRef).toMatch(/^file:v1\//);
      const path = join(fixture().artifactDirectory, row.storageRef.slice(5));
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700);
    }
    expect((first.bundleCompleteness as any).missing).not.toContain(
      'stream.input_not_captured',
    );
    expect((first.bundleCompleteness as any).missing).toContain(
      'stream.engine_not_reported',
    );
    expect((await readRequest(accepted.id)).body.result).toMatchObject({
      chunks: 3,
      audioBytes: Buffer.concat(chunks).length,
    });
    const eventsBefore = await fixture()
      .dataSource.getRepository(ExecutionEventEntity)
      .count();
    const reader = new ExecutionStreamService(
      fixture().dataSource,
      fixture().service,
      app.get(ExecutionArtifactStorageService),
    );
    for (let n = 0; n < 3; n++) {
      expect(
        (await reader.read(accepted.id, 'voice-dictation', scope)).status,
      ).toBe('completed');
      const again = await fixture().service.exportBundle(
        accepted.executionId,
        scope,
        true,
      );
      expect(again.embeddedArtifacts).toEqual(first.embeddedArtifacts);
      expect(again.events).toEqual(first.events);
    }
    const reconnect = captureSocket();
    await until(() => reconnect.connected);
    reconnect.emit('voice:start', {
      requestId: accepted.id,
      mediaType: 'audio/wav',
    });
    await until(() => !!receipt(reconnect));
    expect(count(reconnect, 'voice:ready')).toBe(0);
    expect(upgrades).toBe(1);
    expect(await inputRows()).toHaveLength(3);
    expect(
      await fixture().dataSource.getRepository(ExecutionEventEntity).count(),
    ).toBe(eventsBefore);
  });

  it('fixes capture consent and format to the accepted request', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    const changed = captureSocket();
    await until(() => changed.connected);
    changed.emit('voice:start', {
      requestId: accepted.id,
      mediaType: 'audio/webm',
    });
    await until(() => !changed.connected);
    const noConsent = connect(token());
    await until(() => noConsent.connected);
    noConsent.emit('voice:start', { requestId: accepted.id });
    await until(() => !noConsent.connected);
    expect(upgrades).toBe(1);
    expect(
      await fixture().dataSource.getRepository(ExecutionEntity).count(),
    ).toBe(1);
    s.emit('voice:chunk', silenceWav());
    await until(() => workerInput.length === 1);
    expect(await inputRows()).toHaveLength(1);
  });

  it('closes capture on export revocation before accepting more audio', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    users.get(1).permissions.export = false;
    s.emit('voice:chunk', silenceWav());
    await until(() => !s.connected && active === 0);
    expect(workerInput).toEqual([]);
    expect(await inputRows()).toHaveLength(0);
    await until(
      async () => (await readRequest(accepted.id)).body.status === 'failed',
    );
  });

  it('keeps captured input after cancellation and ignores later chunks and recovery', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    s.emit('voice:chunk', silenceWav());
    await until(() => workerInput.length === 1);
    s.emit('voice:cancel');
    await until(() => active === 0);
    s.emit('voice:chunk', Buffer.from('late'));
    s.emit('voice:stop');
    const reconnect = captureSocket();
    await until(() => reconnect.connected);
    reconnect.emit('voice:start', {
      requestId: accepted.id,
      mediaType: 'audio/wav',
    });
    await until(() => !!receipt(reconnect));
    expect(receipt(reconnect).status).toBe('cancelled');
    expect(workerInput).toHaveLength(1);
    expect(await inputRows()).toHaveLength(1);
    expect(upgrades).toBe(1);
  });

  it('does not capture after common execution cancellation', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    await fixture().service.requestCancellation(accepted.executionId, scope);
    s.emit('voice:chunk', silenceWav());
    await until(() => active === 0);
    expect(workerInput).toEqual([]);
    expect(await inputRows()).toHaveLength(0);
    expect((await readRequest(accepted.id)).body.status).toBe('cancelled');
  });

  it('deduplicates captures and rejects conflicts, gaps, limits and other owners', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    const records = app.get(ExecutionStreamService),
      body = silenceWav();
    expect(
      await records.captureInput(
        accepted.executionId,
        'voice-dictation',
        scope,
        1,
        body,
      ),
    ).toBe(true);
    for (let n = 0; n < 3; n++)
      expect(
        await records.captureInput(
          accepted.executionId,
          'voice-dictation',
          scope,
          1,
          body,
        ),
      ).toBe(false);
    await expect(
      records.captureInput(
        accepted.executionId,
        'voice-dictation',
        scope,
        1,
        Buffer.from('changed'),
      ),
    ).rejects.toMatchObject({ status: 409 });
    for (const seq of [0, 3, 4097])
      await expect(
        records.captureInput(
          accepted.executionId,
          'voice-dictation',
          scope,
          seq,
          body,
        ),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      records.captureInput(
        accepted.executionId,
        'voice-dictation',
        scope,
        2,
        Buffer.alloc(256 * 1024 + 1),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      records.captureInput(
        accepted.executionId,
        'voice-dictation',
        { ownerPrincipal: '2' },
        2,
        body,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      fixture().service.exportBundle(
        accepted.executionId,
        { ownerPrincipal: '2' },
        true,
      ),
    ).rejects.toThrow();
    await expect(
      fixture().service.exportBundle(accepted.executionId, scope, false),
    ).rejects.toThrow();
    expect(await inputRows()).toHaveLength(1);
    expect(workerInput).toEqual([]);
  });

  it('rejects direct capture of a request accepted without consent', async () => {
    const s = connect(token()),
      accepted = await start(s, randomUUID());
    await expect(
      app
        .get(ExecutionStreamService)
        .captureInput(
          accepted.executionId,
          'voice-dictation',
          scope,
          1,
          silenceWav(),
        ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await inputRows()).toHaveLength(0);
  });

  it('fails closed on storage failure without forwarding or exposing its diagnostic', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    const fault = jest
      .spyOn(app.get(ExecutionArtifactStorageService), 'save')
      .mockRejectedValueOnce(new Error('PRIVATE_CAPTURE_STORAGE_DETAILS'));
    s.emit('voice:chunk', silenceWav());
    await until(() => active === 0 && count(s, 'voice:error') > 0);
    fault.mockRestore();
    expect(workerInput).toEqual([]);
    expect(await inputRows()).toHaveLength(0);
    expect((await readRequest(accepted.id)).body.status).toBe('failed');
    expect(JSON.stringify(s.events)).not.toContain(
      'PRIVATE_CAPTURE_STORAGE_DETAILS',
    );
    const bundle = await fixture().service.exportBundle(
      accepted.executionId,
      scope,
      true,
    );
    expect(
      (bundle.events as any[]).filter(
        (event) => event.eventType === 'source.observed',
      ),
    ).toHaveLength(0);
  });

  it('preserves an uncertain capture commit without forwarding it again', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    const records = app.get(ExecutionStreamService),
      original = records.captureInput.bind(records);
    const fault = jest
      .spyOn(records, 'captureInput')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('Simulated lost capture commit confirmation');
      });
    s.emit('voice:chunk', silenceWav());
    await until(() => active === 0 && count(s, 'voice:error') > 0);
    fault.mockRestore();
    expect(workerInput).toEqual([]);
    expect(await inputRows()).toHaveLength(1);
    expect((await readRequest(accepted.id)).body.status).toBe('failed');
    const reconnect = captureSocket();
    await until(() => reconnect.connected);
    reconnect.emit('voice:start', {
      requestId: accepted.id,
      mediaType: 'audio/wav',
    });
    await until(() => !!receipt(reconnect));
    expect(receipt(reconnect).status).toBe('failed');
    expect(upgrades).toBe(1);
    expect(workerInput).toEqual([]);
  });

  async function readBundle(
    executionId: string,
    value = token(),
    consent = 'granted',
  ) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = httpRequest(
        url.replace(/\/voice$/, '') + '/executions/' + executionId + '/bundle',
        {
          headers: {
            Authorization: 'Bearer ' + value,
            'X-Evaluation-Consent': consent,
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (data) => (raw += data.toString()));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: JSON.parse(raw) }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('protects the HTTP bundle using current permissions', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    s.emit('voice:chunk', silenceWav());
    await until(() => workerInput.length === 1);
    s.emit('voice:stop');
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    const good = await readBundle(accepted.executionId);
    expect(good.status).toBe(200);
    const artifacts = good.body.artifacts.filter(
      (row: any) => row.kind === 'stream_input',
    );
    expect(artifacts).toHaveLength(1);
    expect(
      Buffer.from(
        good.body.embeddedArtifacts[artifacts[0].artifactId].data,
        'base64',
      ),
    ).toEqual(silenceWav());
    expect(JSON.stringify(good.body.events)).not.toContain(
      silenceWav().toString('base64'),
    );
    expect(
      (await readBundle(accepted.executionId, token(), 'absent')).status,
    ).toBe(403);
    expect((await readBundle(accepted.executionId, 'invalid')).status).toBe(
      401,
    );
    expect(
      (await readBundle(accepted.executionId, token(1, { type: 'refresh' })))
        .status,
    ).toBe(401);
    users.get(2).permissions.export = true;
    expect((await readBundle(accepted.executionId, token(2))).status).toBe(404);
    const stale = token(1, { permissions: { export: true } });
    users.get(1).permissions.export = false;
    expect((await readBundle(accepted.executionId, stale)).status).toBe(403);
    users.get(1).active = false;
    expect((await readBundle(accepted.executionId, stale)).status).toBe(401);
  });

  it('bounds total persisted input without forwarding it or allocating more workers', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    const records = app.get(ExecutionStreamService),
      body = Buffer.alloc(256 * 1024);
    for (let sequence = 1; sequence <= 128; sequence++)
      expect(
        await records.captureInput(
          accepted.executionId,
          'voice-dictation',
          scope,
          sequence,
          body,
        ),
      ).toBe(true);
    await expect(
      records.captureInput(
        accepted.executionId,
        'voice-dictation',
        scope,
        129,
        body,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await inputRows()).toHaveLength(128);
    expect(workerInput).toEqual([]);
    expect(upgrades).toBe(1);
  });

  it('preserves input withdrawal using the existing evidence lifecycle', async () => {
    const s = captureSocket(),
      accepted = await startCapture(s);
    s.emit('voice:chunk', silenceWav());
    await until(() => workerInput.length === 1);
    s.emit('voice:stop');
    await until(() =>
      s.events.some((e: any) => e.event === 'voice:partial' && e.data.isFinal),
    );
    const [row] = await inputRows();
    await fixture().service.withdrawArtifact(
      accepted.executionId,
      row.artifactId,
      scope,
      'Synthetic audio withdrawal check',
    );
    const bundle = await fixture().service.exportBundle(
      accepted.executionId,
      scope,
      true,
    );
    expect(
      (bundle.embeddedArtifacts as Record<string, unknown>)[row.artifactId],
    ).toBeUndefined();
    const stored = await fixture()
      .dataSource.getRepository(ExecutionArtifactEntity)
      .findOneByOrFail({ artifactId: row.artifactId });
    expect(stored.contentState).toBe('withdrawn');
    await expect(
      stat(join(fixture().artifactDirectory, row.storageRef.slice(5))),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(workerInput).toHaveLength(1);
  });
});
