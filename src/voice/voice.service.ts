import { AuthService } from '../auth/auth.service';
import { authorizeVoiceConnection } from './voice-authorization';
import { assertVoiceEvidence } from './voice-evidence';
import { canonicalHash, canonicalJson } from '../execution/execution-canonical';
import { inferenceCaptureAuthorization } from '../execution/inference-capture';
import { randomUUID } from 'crypto';
import { ExecutionStreamService } from '../execution/execution-stream.service';
import { ExecutionStatus } from '../execution/execution-status.enum';
import { ExecutionEntity } from '../execution/execution.entity';
import { redactExecutionText } from '../execution/execution-data-policy';

interface VoiceSession {
  client: Socket;
  requestId: string;
  ownerPrincipal: string;
  executionId?: string;
  terminal: boolean;
  inputClosed: boolean;
  mediaType?: string;
  evidenceSequence: number;
  runtimeHash?: string;
  pendingCall?: Record<string, any>;
  callIndex: number;
  chunks: number;
  audioBytes: number;
  pending: Promise<unknown>;
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import * as WebSocket from 'ws';
import { Socket } from 'socket.io';

type WorkerStatus = 'free' | 'connecting' | 'busy' | 'closing' | 'down';

interface WorkerSlot {
  port: number;
  status: WorkerStatus;
  ws: WebSocket | null;
  clientId: string | null;
}

interface QueueEntry {
  client: Socket;
  enqueuedAt: number;
}

/**
 * Live-dictation proxy with a pool of Python workers and a FIFO queue.
 *
 * Each client exclusively claims a worker for the duration of its session.
 * When all workers are busy, new clients enter the queue and receive
 * `voice:queued` with their position and ETA. When a worker is released it
 * is assigned to the first session in the queue and `voice:assigned` is
 * emitted to it.
 */
@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceService.name);

  private workers: WorkerSlot[] = [];
  private queue: QueueEntry[] = [];
  private stopping = false;
  private healthTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly pendingRecords = new Set<Promise<unknown>>();
  /** Initial heuristic for average session duration, in seconds. */
  private avgSessionSec = 60;

  constructor(
    private readonly config: ConfigService,
    private readonly records: ExecutionStreamService,
    private readonly auth: AuthService,
  ) {
    this.workers = this.discoverWorkers();
  }

  async onModuleInit() {
    const probes = await Promise.all(
      this.workers.map(async (w) => ({
        w,
        healthy: await this.checkHealth(w.port),
      })),
    );
    for (const { w, healthy } of probes) {
      w.status = healthy ? 'free' : 'down';
    }
    this.healthTimer = setInterval(() => void this.refreshWorkers(), 1000);
    this.healthTimer.unref();
    const usable = this.workers.filter((w) => w.status === 'free').length;
    if (usable === 0) {
      this.logger.warn(
        `Voice pool: 0/${this.workers.length} workers reachable. Remote dictation unavailable.`,
      );
    } else {
      this.logger.log(
        `Voice pool: ${usable}/${this.workers.length} workers reachable on ports ${this.workers
          .filter((w) => w.status === 'free')
          .map((w) => w.port)
          .join(',')}`,
      );
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.healthTimer);
    for (const w of this.workers) {
      if (w.ws) this.releaseWorker(w, 'shutdown');
    }
    for (const entry of this.queue) {
      this.emitError(entry.client, 'backend shutdown');
    }
    this.queue = [];
    await Promise.all([...this.pendingRecords]);
    await Promise.all(
      [...this.sessions.values()].map((session) =>
        this.finish(session, ExecutionStatus.FAILED, 'voice_shutdown').catch(
          () => undefined,
        ),
      ),
    );
  }

  async startSession(
    client: Socket,
    ownerPrincipal: string,
    requestId?: string,
    mediaType?: string,
    captureInput = false,
  ): Promise<void> {
    if (this.stopping || !client.connected) return;
    if (captureInput && !mediaType)
      throw new BadRequestException('Audio media type is required for capture');
    const previous = this.sessions.get(client.id);
    if (previous) {
      if (
        (requestId && requestId !== previous.requestId) ||
        mediaType !== previous.mediaType
      )
        throw new ConflictException('Voice connection already has a session');
      await previous.pending;
      client.emit(
        'voice:accepted',
        await this.records.read(previous.requestId, 'voice-dictation', {
          ownerPrincipal,
        }),
      );
      return;
    }
    const session: VoiceSession = {
      client,
      requestId: requestId ?? randomUUID(),
      ownerPrincipal,
      terminal: false,
      inputClosed: false,
      evidenceSequence: 0,
      callIndex: 0,
      mediaType,
      chunks: 0,
      audioBytes: 0,
      pending: Promise.resolve(),
    };
    this.sessions.set(client.id, session);
    session.pending = this.records.open(
      'voice-dictation',
      {
        requestId: session.requestId,
        ...(captureInput
          ? {
              inputCapture: {
                ...inferenceCaptureAuthorization(ownerPrincipal),
                mediaType,
              },
            }
          : {}),
      },
      session.requestId,
      { ownerPrincipal },
      ['stream.input_not_captured', 'stream.engine_not_reported'],
    );
    const receipt = (await session.pending) as Awaited<
      ReturnType<ExecutionStreamService['open']>
    >;
    session.executionId = receipt.executionId;
    client.emit('voice:accepted', { requestId: session.requestId, ...receipt });
    if (!receipt.claimed) {
      session.terminal = true;
      return;
    }
    if (!client.connected || this.stopping) {
      await this.finish(session, ExecutionStatus.FAILED, 'voice_disconnected');
      return;
    }
    const queued = await this.persist(
      session,
      ExecutionStatus.RUNNING,
      'voice_queued',
    );
    if (
      !client.connected ||
      session.terminal ||
      queued.status !== ExecutionStatus.RUNNING
    ) {
      await this.finish(session, ExecutionStatus.FAILED, 'voice_disconnected');
      return;
    }
    const free = this.workers.find((w) => w.status === 'free');
    if (free) this.assignWorker(free, client);
    else this.enqueue(client);
  }

  private persist(
    session: VoiceSession,
    status: ExecutionStatus,
    phase: string,
    result?: Record<string, unknown>,
  ): Promise<ExecutionEntity> {
    const next = session.pending.then(() =>
      this.records.record(
        session.executionId,
        'voice-dictation',
        { ownerPrincipal: session.ownerPrincipal },
        status,
        phase,
        result,
      ),
    );
    session.pending = next;
    return next;
  }

  private async finish(
    session: VoiceSession,
    status: ExecutionStatus,
    reason: string,
    text?: string,
  ) {
    if (session.terminal) return;
    session.inputClosed = true;
    await session.pending;
    if (!session.executionId) return;
    const sanitized =
      text === undefined ? undefined : redactExecutionText(text);
    const row = await this.persist(session, status, reason, {
      chunks: session.chunks,
      audioBytes: session.audioBytes,
      ...(text === undefined
        ? {}
        : { text: sanitized, redactionApplied: sanitized !== text }),
    });
    session.terminal = ['completed', 'failed', 'cancelled'].includes(
      row.status,
    );
    return row;
  }

  async pushChunk(client: Socket, chunk: ArrayBuffer | Buffer): Promise<void> {
    const session = this.sessions.get(client.id);
    if (
      !session ||
      session.terminal ||
      session.inputClosed ||
      !session.executionId
    )
      return;
    const current = await this.records.read(
      session.requestId,
      'voice-dictation',
      { ownerPrincipal: session.ownerPrincipal },
    );
    if (current.status !== ExecutionStatus.RUNNING) {
      this.releaseIfHolding(client);
      return;
    }
    const worker = this.findWorkerByClient(client.id);
    if (!worker?.ws || worker.ws.readyState !== WebSocket.OPEN) return;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as ArrayBuffer);
    const pending = session.pending.then(async () => {
      if (
        session.mediaType &&
        !(await this.records.captureInput(
          session.executionId,
          'voice-dictation',
          { ownerPrincipal: session.ownerPrincipal },
          session.chunks + 1,
          buf,
        ))
      ) {
        this.releaseIfHolding(client);
        return;
      }
      if (
        !client.connected ||
        worker.clientId !== client.id ||
        worker.ws?.readyState !== WebSocket.OPEN
      )
        return;
      session.chunks++;
      session.audioBytes += buf.length;
      worker.ws.send(buf, { binary: true });
    });
    // A failed write must not poison the chain used to persist terminal state.
    session.pending = pending.catch(() => undefined);
    try {
      await pending;
    } catch {
      await this.finish(
        session,
        ExecutionStatus.FAILED,
        'voice_input_unconfirmed',
      ).catch(() => undefined);
      this.releaseWorker(worker, 'input_unconfirmed');
      this.emitError(client, 'Voice input could not be confirmed');
    }
  }

  async stopSession(client: Socket): Promise<void> {
    const session = this.sessions.get(client.id);
    if (!session || session.terminal || session.inputClosed) return;
    session.inputClosed = true;
    const row = await this.persist(
      session,
      ExecutionStatus.RUNNING,
      'voice_stopping',
    );
    if (row.status !== ExecutionStatus.RUNNING) {
      this.releaseIfHolding(client);
      return;
    }
    const worker = this.findWorkerByClient(client.id);
    if (!worker?.ws || worker.ws.readyState !== WebSocket.OPEN) return;
    worker.ws.send(JSON.stringify({ type: 'stop' }));
    // The partial with isFinal: true closes the cycle and releases the slot.
  }

  async cancelSession(client: Socket): Promise<void> {
    const session = this.sessions.get(client.id);
    if (session)
      await this.finish(session, ExecutionStatus.CANCELLED, 'voice_cancelled');
    const entryIdx = this.queue.findIndex((e) => e.client.id === client.id);
    if (entryIdx >= 0) {
      this.queue.splice(entryIdx, 1);
      this.notifyQueuePositions();
      return;
    }
    const worker = this.findWorkerByClient(client.id);
    if (!worker) return;
    if (worker.ws?.readyState === WebSocket.OPEN) {
      try {
        worker.ws.send(JSON.stringify({ type: 'cancel' }));
      } catch {
        /* ignore */
      }
    }
    this.releaseWorker(worker, 'client-cancel');
  }

  releaseIfHolding(client: Socket): void {
    const session = this.sessions.get(client.id);
    this.sessions.delete(client.id);
    if (session) {
      const closing = this.finish(
        session,
        ExecutionStatus.FAILED,
        'voice_disconnected',
      ).catch(() =>
        this.emitError(client, 'Voice state could not be confirmed'),
      );
      this.pendingRecords.add(closing);
      void closing.finally(() => this.pendingRecords.delete(closing));
    }
    const entryIdx = this.queue.findIndex((e) => e.client.id === client.id);
    if (entryIdx >= 0) {
      this.queue.splice(entryIdx, 1);
      this.notifyQueuePositions();
      return;
    }
    const worker = this.findWorkerByClient(client.id);
    if (worker) this.releaseWorker(worker, 'client-disconnect');
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private discoverWorkers(): WorkerSlot[] {
    const explicit = this.config.get<string>('VOICE_WORKER_PORTS');
    let ports: number[];
    if (explicit) {
      ports = explicit
        .split(',')
        .map((p) => Number(p.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else {
      const base = Number(
        this.config.get<string>('VOICE_WORKER_BASE_PORT') || 9100,
      );
      const size = Math.max(
        1,
        Number(this.config.get<string>('VOICE_WORKER_POOL_SIZE') || 1),
      );
      ports = Array.from({ length: size }, (_, i) => base + i);
    }
    return ports.map((port) => ({
      port,
      status: 'down' as WorkerStatus,
      ws: null,
      clientId: null,
    }));
  }

  private assignWorker(worker: WorkerSlot, client: Socket): void {
    // Reserve synchronously: another start/queue promotion cannot select it.
    worker.status = 'connecting';
    worker.clientId = client.id;
    const session = this.sessions.get(client.id);
    let ws: WebSocket;
    try {
      ws = this.openWorkerWs(worker.port);
    } catch {
      worker.status = 'down';
      worker.clientId = null;
      void this.finish(
        session,
        ExecutionStatus.FAILED,
        'voice_worker_unavailable',
      ).catch(() => undefined);
      this.emitError(client, 'Could not contact voice worker');
      this.processQueue();
      return;
    }
    worker.ws = ws;
    const owns = () => worker.ws === ws && worker.clientId === client.id;
    ws.on('open', () => {
      void (async () => {
        if (!owns() || worker.status !== 'connecting') return;
        if (!client.connected || this.stopping) {
          this.releaseWorker(worker, 'client-disconnect');
          return;
        }
        const state = await this.persist(
          session,
          ExecutionStatus.RUNNING,
          'voice_assigned',
        );
        if (
          !owns() ||
          !client.connected ||
          session.terminal ||
          state.status !== ExecutionStatus.RUNNING
        ) {
          this.releaseWorker(worker, 'voice_inactive');
          return;
        }
        worker.status = 'busy';
        ws.send(
          JSON.stringify({ type: 'start', capture: !!session.mediaType }),
        );
        client.emit('voice:ready');
        client.emit('voice:assigned');
        this.logger.log(
          `assigned port=${worker.port} client=${client.id} queue=${this.queue.length}`,
        );
      })().catch(() => {
        this.releaseWorker(worker, 'persistence_failed');
        this.emitError(client, 'Voice state could not be confirmed');
      });
    });
    let output = Promise.resolve();
    let pendingOutput = 0;
    ws.on('message', (data, isBinary) => {
      if (!owns() || worker.status !== 'busy' || !client.connected) return;
      if (++pendingOutput > 32) {
        this.releaseWorker(worker, 'worker_output_limit');
        return;
      }
      output = output
        .then(() => this.onWorkerMessage(worker, client, data, isBinary))
        .catch(async () => {
          await this.finish(
            session,
            ExecutionStatus.FAILED,
            'voice_result_unconfirmed',
          ).catch(() => undefined);
          this.releaseWorker(worker, 'result_unconfirmed');
          this.emitError(client, 'Voice result could not be confirmed');
        })
        .finally(() => {
          pendingOutput--;
        });
    });
    ws.on('error', () => {
      if (!owns()) return;
      worker.status = 'down';
      void this.finish(
        session,
        ExecutionStatus.FAILED,
        'voice_worker_error',
      ).catch(() => undefined);
      this.emitError(client, 'Voice worker connection failed');
      this.releaseWorker(worker, 'worker-error');
    });
    ws.on('close', () => {
      // The peer may close immediately after its final frame. Persist already
      // received output in order before deciding that the stream was lost.
      void output.then(async () => {
        if (worker.ws !== ws) return;
        await this.finish(
          session,
          ExecutionStatus.FAILED,
          'voice_worker_closed',
        ).catch(() => undefined);
        worker.ws = null;
        worker.clientId = null;
        worker.status = 'down';
        if (!this.stopping && (await this.checkHealth(worker.port)))
          worker.status = 'free';
        ws.removeAllListeners();
        this.logger.log(
          `released port=${worker.port} client=${client.id} queue=${this.queue.length}`,
        );
        this.processQueue();
      });
    });
  }

  private enqueue(client: Socket): void {
    this.queue.push({ client, enqueuedAt: Date.now() });
    this.logger.log(
      `queued client=${client.id} queueDepth=${this.queue.length}`,
    );
    this.notifyQueuePositions();
  }

  private notifyQueuePositions(): void {
    this.queue.forEach((entry, idx) => {
      // position 1-based
      const position = idx + 1;
      const eta = position * this.avgSessionSec;
      try {
        entry.client.emit('voice:queued', { position, eta });
      } catch {
        /* ignore */
      }
    });
  }

  private processQueue(): void {
    while (!this.stopping && this.queue.length > 0) {
      const free = this.workers.find((w) => w.status === 'free');
      if (!free) break;
      const next = this.queue.shift()!;
      if (next.client.connected) this.assignWorker(free, next.client);
    }
    this.notifyQueuePositions();
  }

  private async onWorkerMessage(
    worker: WorkerSlot,
    client: Socket,
    data: WebSocket.RawData,
    isBinary: boolean,
  ) {
    if (isBinary) return;
    const session = this.sessions.get(client.id);
    if (!session || session.terminal) return;
    let payload: {
      type?: string;
      sequence?: number;
      kind?: string;
      value?: any;
      text?: string;
      isFinal?: boolean;
      message?: string;
    };
    try {
      payload = JSON.parse(data.toString());
    } catch {
      throw new Error('Invalid voice worker response');
    }
    if (payload?.type === 'evidence') {
      await this.onEvidence(session, payload);
      return;
    }
    if (payload?.type === 'partial') {
      if (
        typeof payload.text !== 'string' ||
        typeof payload.isFinal !== 'boolean' ||
        Buffer.byteLength(payload.text) > 1024 * 1024
      )
        throw new Error('Invalid voice result');
      if (payload.isFinal) {
        const row = await this.finish(
          session,
          ExecutionStatus.COMPLETED,
          'voice_final',
          payload.text,
        );
        if (
          !row ||
          row.status !== ExecutionStatus.COMPLETED ||
          !client.connected
        ) {
          this.releaseWorker(worker, 'voice_inactive');
          return;
        }
      } else {
        const state = await this.records.read(
          session.requestId,
          'voice-dictation',
          { ownerPrincipal: session.ownerPrincipal },
        );
        if (state.status !== ExecutionStatus.RUNNING || !client.connected) {
          this.releaseIfHolding(client);
          return;
        }
      }
      client.emit('voice:partial', {
        text: payload.text ?? '',
        isFinal: !!payload.isFinal,
      });
      if (payload.isFinal) {
        this.releaseWorker(worker, 'final');
      }
      return;
    }
    if (payload?.type === 'error') {
      await this.finish(session, ExecutionStatus.FAILED, 'voice_worker_error');
      this.emitError(client, 'Voice worker failed');
      this.releaseWorker(worker, 'worker-error');
    }
  }

  private async onEvidence(
    session: VoiceSession,
    frame: {
      sequence?: number;
      kind?: string;
      value?: any;
    },
  ) {
    if (!session.mediaType)
      throw new Error('Voice evidence consent is unavailable');
    const authority = await authorizeVoiceConnection(this.auth, session.client);
    if (
      !session.client.connected ||
      authority.principal !== session.ownerPrincipal ||
      !authority.captureInput
    )
      throw new Error('Voice evidence authorization required');
    const { sequence, kind, value } = frame;
    assertVoiceEvidence(kind, value);
    const duplicate =
      Number.isSafeInteger(sequence) && sequence <= session.evidenceSequence;
    if (!duplicate) {
      if (kind === 'stream_runtime') {
        if (sequence !== 1 || session.runtimeHash)
          throw new Error('Voice runtime order differs');
      } else {
        if (
          value.runtimeHash !== session.runtimeHash ||
          value.input.chunks > session.chunks ||
          value.input.bytes > session.audioBytes
        )
          throw new Error('Voice evidence binding differs');
        if (value.phase === 'started') {
          if (session.pendingCall || value.index !== session.callIndex + 1)
            throw new Error('Voice call order differs');
        } else if (
          !session.pendingCall ||
          canonicalHash({
            ...value,
            phase: 'started',
            ...{
              decoded: undefined,
              decodeUs: undefined,
              inferenceUs: undefined,
              parameters: undefined,
              audioDurationUs: undefined,
              audioAfterVadUs: undefined,
              text: undefined,
              finishedAt: undefined,
              errorCode: undefined,
            },
          }) !== canonicalHash(session.pendingCall)
        )
          throw new Error('Voice call identity differs');
      }
    }
    const runtime = kind === 'stream_runtime';
    const key = 'stream.call.' + String(value.index) + '.finish';
    const stored = await this.records.captureEvidence(
      session.executionId,
      'voice-dictation',
      { ownerPrincipal: session.ownerPrincipal },
      sequence,
      kind as 'stream_runtime' | 'stream_inference',
      Buffer.from(canonicalJson(value)),
      {
        add: runtime
          ? [
              'stream.calls_unconfirmed',
              'stream.generation_defaults_not_captured',
            ]
          : value.phase === 'started'
            ? [key]
            : [],
        resolve: runtime
          ? ['stream.engine_not_reported']
          : [
              'stream.calls_unconfirmed',
              ...(value.phase === 'started' ? [] : [key]),
            ],
      },
    );
    if (!stored || duplicate) return;
    session.evidenceSequence = sequence;
    if (runtime) session.runtimeHash = canonicalHash(value);
    else if (value.phase === 'started') {
      session.pendingCall = value;
      session.callIndex = value.index;
    } else session.pendingCall = undefined;
  }

  private async refreshWorkers() {
    if (this.stopping || this.refreshing) return;
    this.refreshing = true;
    let recovered = false;
    try {
      for (const worker of this.workers) {
        if (
          worker.status === 'down' &&
          !worker.ws &&
          (await this.checkHealth(worker.port)) &&
          !this.stopping
        ) {
          worker.status = 'free';
          recovered = true;
        }
      }
      if (recovered && !this.stopping) this.processQueue();
    } finally {
      this.refreshing = false;
    }
  }

  private openWorkerWs(port: number): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}/voice`, {
      handshakeTimeout: 3000,
      maxPayload: 2 * 1024 * 1024,
    });
  }

  private releaseWorker(worker: WorkerSlot, reason: string): void {
    const ws = worker.ws;
    if (!ws || worker.status === 'closing') return;
    worker.clientId = null;
    if (worker.status !== 'down') worker.status = 'closing';
    // Keep the slot reserved until close, including a cancelled handshake.
    // Its listeners remain installed to consume pending error/close events.
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, reason);
    else if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
  }

  private findWorkerByClient(clientId: string): WorkerSlot | undefined {
    return this.workers.find((w) => w.clientId === clientId);
  }

  private findQueueEntry(clientId: string): QueueEntry | undefined {
    return this.queue.find((e) => e.client.id === clientId);
  }

  private emitError(client: Socket, message: string) {
    try {
      client.emit('voice:error', { message });
    } catch {
      /* ignore */
    }
  }

  private checkHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/health', timeout: 1500 },
        (res) => {
          res.resume();
          resolve((res.statusCode || 0) === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }
}
