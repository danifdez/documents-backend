import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { ExecutionStepKind } from '../../../src/execution/execution-step-kind.enum';
import { ExecutionProtocolController } from '../../../src/execution/execution-protocol.controller';

describe('ExecutionProtocolController throttling', () => {
  const skipMetadata = 'THROTTLER:SKIPdefault';

  it('exempts only high-frequency authenticated lease maintenance routes', () => {
    const prototype = ExecutionProtocolController.prototype;

    expect(Reflect.getMetadata(skipMetadata, prototype.renewLease)).toBe(true);
    expect(Reflect.getMetadata(skipMetadata, prototype.control)).toBe(true);
    expect(Reflect.getMetadata(skipMetadata, prototype.claim)).toBeUndefined();
    expect(
      Reflect.getMetadata(skipMetadata, prototype.register),
    ).toBeUndefined();
    expect(Reflect.getMetadata(skipMetadata, prototype.result)).toBeUndefined();
  });
});

describe('ExecutionProtocolController worker requests', () => {
  const workerId = '29e0335e-0d3b-4144-9ae4-293d65b1e380';
  const attemptId = '19e0335e-0d3b-4144-9ae4-293d65b1e380';
  const credential = 'fixture-worker';
  const enrollment = 'fixture-enrollment';
  let attempts: Record<string, jest.Mock>;
  let workers: Record<string, jest.Mock>;
  let config: { get: jest.Mock };
  let controller: ExecutionProtocolController;
  const metadata = { runtime: 'test' };
  const workerConfig = {
    capabilities: ['summary'],
    stepKinds: [ExecutionStepKind.CODE],
    maximumConcurrency: 2,
    metadata,
  };

  beforeEach(() => {
    attempts = Object.fromEntries(
      [
        'claimReadyStepWithWait',
        'startAttempt',
        'renewAttemptLease',
        'readAttemptControl',
        'getInputArtifact',
        'receiveResult',
        'uploadOutputArtifact',
      ].map((name) => [name, jest.fn()]),
    );
    workers = {
      authenticate: jest.fn(),
      registerModels: jest
        .fn()
        .mockResolvedValue({ worker: { id: workerId }, credential }),
      heartbeatModels: jest.fn(),
    };
    config = { get: jest.fn().mockReturnValue(enrollment) };
    controller = new ExecutionProtocolController(
      attempts as any,
      workers as any,
      config as any,
    );
  });

  it('requires the configured enrollment token before registering a worker', async () => {
    const body = {
      ...workerConfig,
      protocolVersion: 'step-protocol/1' as const,
      workerId,
      name: 'Test worker',
    };
    for (const value of [undefined, 'short', 'other-enrollment']) {
      await expect(controller.register(value, body)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    config.get.mockReturnValueOnce(undefined);
    await expect(controller.register(enrollment, body)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(workers.registerModels).not.toHaveBeenCalled();
    await expect(controller.register(enrollment, body)).resolves.toEqual({
      workerId,
      credential,
    });
    expect(workers.registerModels).toHaveBeenCalledWith(
      workerId,
      'Test worker',
      ['summary'],
      [ExecutionStepKind.CODE],
      2,
      metadata,
    );
  });

  it('authenticates worker operations and preserves capacity and lease settings', async () => {
    workers.authenticate.mockRejectedValueOnce(new UnauthorizedException());
    const claim = {
      capabilities: ['summary'],
      stepKinds: [ExecutionStepKind.CODE],
      leaseDurationMs: 60000,
      waitTimeoutMs: 1000,
    };
    await expect(
      controller.claim(workerId, undefined, claim),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(attempts.claimReadyStepWithWait).not.toHaveBeenCalled();
    await expect(
      controller.heartbeat(workerId, credential, {
        ...workerConfig,
        protocolVersion: 'step-protocol/1',
      }),
    ).resolves.toEqual({ acknowledgedAt: expect.any(Date) });
    await controller.claim(workerId, credential, claim);
    await controller.start(attemptId, workerId, credential);
    await controller.renewLease(attemptId, workerId, credential, {
      leaseDurationMs: 90000,
    });
    await controller.control(attemptId, workerId, credential);
    expect(workers.heartbeatModels).toHaveBeenCalledWith(
      workerId,
      ['summary'],
      [ExecutionStepKind.CODE],
      2,
      metadata,
    );
    expect(attempts.claimReadyStepWithWait).toHaveBeenCalledWith(
      {
        workerId,
        capabilities: ['summary'],
        stepKinds: [ExecutionStepKind.CODE],
        leaseDurationMs: 60000,
        enforceRegisteredWorkerCapacity: true,
      },
      1000,
    );
    expect(attempts.startAttempt).toHaveBeenCalledWith(attemptId, workerId);
    expect(attempts.renewAttemptLease).toHaveBeenCalledWith(
      attemptId,
      workerId,
      90000,
    );
    expect(attempts.readAttemptControl).toHaveBeenCalledWith(
      attemptId,
      workerId,
    );
  });

  it('streams worker input and scopes uploads and results to the worker', async () => {
    const artifactId = 'a7d5f0ca-a719-4cba-b6e4-1cdd566a0d21';
    const body = Buffer.from('evidence');
    const response = { setHeader: jest.fn() };
    attempts.getInputArtifact.mockResolvedValue({
      body,
      mediaType: 'text/plain',
      size: '8',
      contentHash: 'hash',
    });
    const file = await controller.artifact(
      attemptId,
      artifactId,
      workerId,
      credential,
      response as any,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(body);
    expect(response.setHeader.mock.calls).toEqual([
      ['content-type', 'text/plain'],
      ['content-length', '8'],
      ['etag', '"hash"'],
    ]);
    expect(attempts.getInputArtifact).toHaveBeenCalledWith(
      attemptId,
      workerId,
      artifactId,
    );
    const upload = {
      artifactId,
      bodyBase64: body.toString('base64'),
      mediaType: 'text/plain',
    };
    await controller.uploadArtifact(
      attemptId,
      workerId,
      credential,
      upload as any,
    );
    expect(attempts.uploadOutputArtifact).toHaveBeenCalledWith(
      attemptId,
      workerId,
      {
        ...upload,
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: false },
        retentionClass: 'operational',
        inputSourceIds: [],
      },
    );
    const result = {
      executionId: 'execution',
      stepId: 'step',
      operationId: 'operation',
      attemptId,
    };
    await controller.result(workerId, credential, result as any);
    expect(attempts.receiveResult).toHaveBeenCalledWith({
      ...result,
      workerId,
      result,
    });
  });
});
