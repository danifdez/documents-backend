import {
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
  /** Initial heuristic for average session duration, in seconds. */
  private avgSessionSec = 60;

  constructor(private readonly config: ConfigService) {
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
    for (const w of this.workers) {
      if (w.ws) this.releaseWorker(w, 'shutdown');
    }
    for (const entry of this.queue) {
      this.emitError(entry.client, 'backend shutdown');
    }
    this.queue = [];
  }

  startSession(client: Socket): void {
    if (this.stopping || !client.connected) return;
    if (this.findWorkerByClient(client.id)) return;
    if (this.findQueueEntry(client.id)) return;

    const free = this.workers.find((w) => w.status === 'free');
    if (free) {
      this.assignWorker(free, client);
      return;
    }
    this.enqueue(client);
  }

  pushChunk(client: Socket, chunk: ArrayBuffer | Buffer): void {
    const worker = this.findWorkerByClient(client.id);
    if (!worker?.ws || worker.ws.readyState !== WebSocket.OPEN) return;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as ArrayBuffer);
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
      try {
        worker.ws.send(JSON.stringify({ type: 'cancel' }));
      } catch {
        /* ignore */
      }
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
    let ws: WebSocket;
    try {
      ws = this.openWorkerWs(worker.port);
    } catch {
      worker.status = 'down';
      worker.clientId = null;
      this.emitError(client, 'Could not contact voice worker');
      this.processQueue();
      return;
    }
    worker.ws = ws;
    const owns = () => worker.ws === ws && worker.clientId === client.id;
    ws.on('open', () => {
      if (!owns() || worker.status !== 'connecting') return;
      if (!client.connected || this.stopping) {
        this.releaseWorker(worker, 'client-disconnect');
        return;
      }
      worker.status = 'busy';
      client.emit('voice:ready');
      client.emit('voice:assigned');
      this.logger.log(
        `assigned port=${worker.port} client=${client.id} queue=${this.queue.length}`,
      );
    });
    ws.on('message', (data, isBinary) => {
      if (owns() && worker.status === 'busy' && client.connected) {
        this.onWorkerMessage(worker, client, data, isBinary);
      }
    });
    ws.on('error', () => {
      if (!owns()) return;
      worker.status = 'down';
      this.emitError(client, 'Voice worker connection failed');
      this.releaseWorker(worker, 'worker-error');
    });
    ws.on('close', () => {
      if (worker.ws !== ws) return;
      worker.ws = null;
      worker.clientId = null;
      if (worker.status !== 'down') worker.status = 'free';
      ws.removeAllListeners();
      this.logger.log(
        `released port=${worker.port} client=${client.id} queue=${this.queue.length}`,
      );
      this.processQueue();
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

  private onWorkerMessage(
    worker: WorkerSlot,
    client: Socket,
    data: WebSocket.RawData,
    isBinary: boolean,
  ) {
    if (isBinary) return;
    let payload: {
      type?: string;
      text?: string;
      isFinal?: boolean;
      message?: string;
    };
    try {
      payload = JSON.parse(data.toString());
    } catch {
      this.logger.warn(`Worker port=${worker.port} sent non-JSON text frame`);
      return;
    }
    if (payload.type === 'partial') {
      client.emit('voice:partial', {
        text: payload.text ?? '',
        isFinal: !!payload.isFinal,
      });
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
