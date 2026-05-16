import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import WebSocket = require('ws');
import { Socket } from 'socket.io';

type WorkerStatus = 'free' | 'busy' | 'down';

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
  /** Initial heuristic for average session duration, in seconds. */
  private avgSessionSec = 60;

  constructor(private readonly config: ConfigService) {
    this.workers = this.discoverWorkers();
  }

  async onModuleInit() {
    const probes = await Promise.all(
      this.workers.map(async (w) => ({ w, healthy: await this.checkHealth(w.port) })),
    );
    for (const { w, healthy } of probes) {
      w.status = healthy ? 'free' : 'down';
    }
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
    for (const w of this.workers) {
      if (w.ws) this.closeWorkerWs(w, 'shutdown');
    }
    for (const entry of this.queue) {
      this.emitError(entry.client, 'backend shutdown');
    }
    this.queue = [];
  }

  /**
   * Reserves a worker for this client. If none is free, enqueues it.
   * Returns `true` whenever the session has been admitted (queued counts);
   * `false` is left as a semantic placeholder for backwards compatibility
   * with the single-worker version — today we never return it.
   */
  async startSession(client: Socket): Promise<boolean> {
    if (this.findWorkerByClient(client.id)) return true;
    if (this.findQueueEntry(client.id)) return true;

    const free = this.workers.find((w) => w.status === 'free');
    if (free) {
      await this.assignWorker(free, client);
      return true;
    }
    this.enqueue(client);
    return true;
  }

  pushChunk(client: Socket, chunk: ArrayBuffer | Buffer): void {
    const worker = this.findWorkerByClient(client.id);
    if (!worker?.ws || worker.ws.readyState !== WebSocket.OPEN) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    worker.ws.send(buf, { binary: true });
  }

  stopSession(client: Socket): void {
    const worker = this.findWorkerByClient(client.id);
    if (!worker?.ws || worker.ws.readyState !== WebSocket.OPEN) return;
    worker.ws.send(JSON.stringify({ type: 'stop' }));
    // The partial with isFinal: true closes the cycle and releases the slot.
  }

  cancelSession(client: Socket): void {
    const entryIdx = this.queue.findIndex((e) => e.client.id === client.id);
    if (entryIdx >= 0) {
      this.queue.splice(entryIdx, 1);
      this.notifyQueuePositions();
      return;
    }
    const worker = this.findWorkerByClient(client.id);
    if (!worker) return;
    if (worker.ws?.readyState === WebSocket.OPEN) {
      try { worker.ws.send(JSON.stringify({ type: 'cancel' })); } catch { /* ignore */ }
    }
    this.releaseWorker(worker, 'client-cancel');
  }

  releaseIfHolding(client: Socket): void {
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
      const base = Number(this.config.get<string>('VOICE_WORKER_BASE_PORT') || 9100);
      const size = Math.max(1, Number(this.config.get<string>('VOICE_WORKER_POOL_SIZE') || 1));
      ports = Array.from({ length: size }, (_, i) => base + i);
    }
    return ports.map((port) => ({ port, status: 'down' as WorkerStatus, ws: null, clientId: null }));
  }

  private async assignWorker(worker: WorkerSlot, client: Socket): Promise<void> {
    let ws: WebSocket;
    try {
      ws = await this.openWorkerWs(worker.port);
    } catch (err) {
      worker.status = 'down';
      this.emitError(client, `could not contact worker: ${(err as Error).message}`);
      // Try to promote another client from the queue to another worker.
      this.processQueue();
      return;
    }
    worker.status = 'busy';
    worker.ws = ws;
    worker.clientId = client.id;

    ws.on('message', (data, isBinary) => this.onWorkerMessage(worker, client, data, isBinary));
    ws.on('close', () => {
      if (worker.clientId === client.id) this.releaseWorker(worker, 'worker-closed');
    });
    ws.on('error', (err) => {
      if (worker.clientId === client.id) {
        this.emitError(client, `worker error: ${err.message}`);
        worker.status = 'down';
        this.releaseWorker(worker, 'worker-error');
      }
    });

    client.emit('voice:ready');
    client.emit('voice:assigned');
    this.logger.log(`assigned port=${worker.port} client=${client.id} queue=${this.queue.length}`);
  }

  private enqueue(client: Socket): void {
    this.queue.push({ client, enqueuedAt: Date.now() });
    this.logger.log(`queued client=${client.id} queueDepth=${this.queue.length}`);
    this.notifyQueuePositions();
  }

  private notifyQueuePositions(): void {
    this.queue.forEach((entry, idx) => {
      // position 1-based
      const position = idx + 1;
      const eta = position * this.avgSessionSec;
      try { entry.client.emit('voice:queued', { position, eta }); } catch { /* ignore */ }
    });
  }

  private processQueue(): void {
    while (this.queue.length > 0) {
      const free = this.workers.find((w) => w.status === 'free');
      if (!free) break;
      const next = this.queue.shift()!;
      // Fire-and-forget assignment; errors are handled by assign itself.
      void this.assignWorker(free, next.client);
    }
    this.notifyQueuePositions();
  }

  private onWorkerMessage(
    worker: WorkerSlot,
    client: Socket,
    data: WebSocket.RawData,
    isBinary: boolean,
  ) {
    if (isBinary) return;
    let payload: { type?: string; text?: string; isFinal?: boolean; message?: string };
    try {
      payload = JSON.parse(data.toString());
    } catch {
      this.logger.warn(`Worker port=${worker.port} sent non-JSON text frame`);
      return;
    }
    if (payload.type === 'partial') {
      client.emit('voice:partial', { text: payload.text ?? '', isFinal: !!payload.isFinal });
      if (payload.isFinal) {
        this.releaseWorker(worker, 'final');
      }
      return;
    }
    if (payload.type === 'error') {
      this.emitError(client, payload.message || 'unknown worker error');
      this.releaseWorker(worker, 'worker-error');
    }
  }

  private openWorkerWs(port: number): Promise<WebSocket> {
    const url = `ws://127.0.0.1:${port}/voice`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 3000, maxPayload: 2 * 1024 * 1024 });
      const onOpen = () => { ws.off('error', onError); resolve(ws); };
      const onError = (err: Error) => { ws.off('open', onOpen); reject(err); };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  private releaseWorker(worker: WorkerSlot, reason: string): void {
    const port = worker.port;
    const clientId = worker.clientId;
    if (worker.ws) this.closeWorkerWs(worker, reason);
    if (worker.status !== 'down') worker.status = 'free';
    worker.clientId = null;
    this.logger.log(`released port=${port} client=${clientId} reason=${reason} queue=${this.queue.length}`);
    this.processQueue();
  }

  private closeWorkerWs(worker: WorkerSlot, reason: string): void {
    const ws = worker.ws;
    worker.ws = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, reason);
      else ws.terminate();
    } catch { /* ignore */ }
    ws.removeAllListeners();
  }

  private findWorkerByClient(clientId: string): WorkerSlot | undefined {
    return this.workers.find((w) => w.clientId === clientId);
  }

  private findQueueEntry(clientId: string): QueueEntry | undefined {
    return this.queue.find((e) => e.client.id === clientId);
  }

  private emitError(client: Socket, message: string) {
    try { client.emit('voice:error', { message }); } catch { /* ignore */ }
  }

  private checkHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/health', timeout: 1500 },
        (res) => { res.resume(); resolve((res.statusCode || 0) === 200); },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }
}
