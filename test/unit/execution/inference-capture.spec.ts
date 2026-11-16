import { BrowserInferenceController } from '../../../src/model/browser-inference.controller';
import { ForbiddenException } from '@nestjs/common';
import { ModelController } from '../../../src/model/model.controller';
import { canonicalHash } from '../../../src/execution/execution-canonical';
import {
  assertInferenceRuntimeCapture,
  assertInferenceExchange,
} from '../../../src/execution/inference-capture';
import { ExecutionService } from '../../../src/execution/execution.service';

const ids = {
  executionId: '01234567-89ab-4def-8123-456789abcdef',
  stepId: '11234567-89ab-4def-8123-456789abcdef',
  operationId: '21234567-89ab-4def-8123-456789abcdef',
  attemptId: '31234567-89ab-4def-8123-456789abcdef',
};
const grant = {
  schemaVersion: 'inference-capture/1',
  purpose: 'evaluation',
  authorizedBy: '7',
};
const execution = {
  executionId: ids.executionId,
  taskType: 'summarize',
  ownerPrincipal: '7',
  payload: {},
  missingEvidence: [],
};
const step = {
  stepKind: 'inference',
  stepId: ids.stepId,
  operationId: ids.operationId,
  work: { taskType: 'summarize-map', inferenceCapture: grant },
};
const exchange = () => ({
  schemaVersion: 'inference-exchange/1',
  ...ids,
  callIndex: 1,
  startedAt: '2026-11-14T21:00:00Z',
  finishedAt: '2026-11-14T21:00:01Z',
  durationMs: 1000,
  status: 'completed',
  request: {
    method: 'POST',
    path: '/v1/chat/completions',
    mediaType: 'application/json',
    bodyBase64: Buffer.from('{"messages":[]}').toString('base64'),
  },
  response: {
    status: 200,
    bodyBase64: Buffer.from('{"choices":[]}').toString('base64'),
  },
});

describe('Summary inference capture authorization', () => {
  const service = {
    summarize: jest.fn().mockResolvedValue({ executionId: ids.executionId }),
  };
  const executions = {
    resolveAccessScope: jest.fn().mockReturnValue({ ownerPrincipal: '7' }),
  };
  const controller = new ModelController(service as any, executions as any);
  beforeEach(() => jest.clearAllMocks());

  it('requires explicit consent before authorizing a capture', async () => {
    await controller.summarize(
      { resourceId: 1, targetLanguage: 'en' },
      { userId: 7, permissions: { export: true } },
    );
    expect(service.summarize.mock.calls[0].at(-1)).toBe(false);
  });
  it('requires an authenticated exporter even in standalone mode', async () => {
    for (const user of [
      undefined,
      { userId: 7, permissions: {} },
      { userId: 7, permissions: { export: 'true' } },
    ]) {
      await expect(
        controller.summarize({ targetLanguage: 'en' }, user, 'granted'),
      ).rejects.toThrow(ForbiddenException);
    }
    expect(service.summarize).not.toHaveBeenCalled();
  });
  it('authorizes the existing scoped summary operation', async () => {
    await controller.summarize(
      { resourceId: 1, targetLanguage: 'en' },
      { userId: 7, permissions: { export: true } },
      'granted',
    );
    expect(service.summarize.mock.calls[0][0]).toEqual({ ownerPrincipal: '7' });
    expect(service.summarize.mock.calls[0].at(-1)).toBe(true);
  });
});

describe('Attempt-scoped inference exchange validation', () => {
  const validate = (
    value = exchange(),
    root: any = execution,
    current: any = step,
  ) =>
    assertInferenceExchange(
      Buffer.from(JSON.stringify(value)),
      root,
      current,
      ids.attemptId,
    );
  it('accepts the raw exchange using the canonical attempt IDs', () =>
    expect(() => validate()).not.toThrow());
  it('rejects artifacts without a matching authenticated owner', () => {
    for (const root of [
      { ...execution, ownerPrincipal: '8' },
      { ...execution, ownerPrincipal: 'standalone' },
    ])
      expect(() => validate(exchange(), root)).toThrow(
        'invalid_inference_exchange',
      );
  });
  it.each(['ask', 'translate', 'future-operation'])(
    'accepts a server-authorized inference for %s without a type registry',
    (taskType) => {
      expect(() =>
        validate(
          exchange(),
          { ...execution, taskType },
          { ...step, work: { ...step.work, taskType } },
        ),
      ).not.toThrow();
    },
  );
  it('rejects absent authorization and non-inference steps', () => {
    for (const current of [
      { ...step, work: { taskType: 'anything' } },
      { ...step, stepKind: 'code' },
    ]) {
      expect(() => validate(exchange(), execution, current)).toThrow(
        'invalid_inference_exchange',
      );
    }
  });
  it('rejects foreign attempts and unexpected metadata such as credentials', () => {
    for (const changed of [
      { ...exchange(), attemptId: 'foreign' },
      { ...exchange(), operationId: 'foreign' },
      { ...exchange(), authorization: 'PRIVATE' },
      {
        ...exchange(),
        request: {
          ...exchange().request,
          headers: { Authorization: 'PRIVATE' },
        },
      },
      { ...exchange(), callIndex: 5 },
    ]) {
      expect(() => validate(changed as any)).toThrow(
        'invalid_inference_exchange',
      );
    }
  });
  it('rejects noncanonical or oversized base64 bodies', () => {
    for (const bodyBase64 of [
      '!',
      Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
    ])
      expect(() =>
        validate({
          ...exchange(),
          request: { ...exchange().request, bodyBase64 },
        }),
      ).toThrow('invalid_inference_exchange');
  });
  it('accepts explicit partial evidence without fabricating a response', () => {
    expect(() =>
      validate({ ...exchange(), status: 'transport_error', response: null }),
    ).not.toThrow();
    expect(() =>
      validate({ ...exchange(), status: 'completed', response: null }),
    ).toThrow('invalid_inference_exchange');
  });
});

describe('Inference replay completeness', () => {
  const derive = (ExecutionService.prototype as any)
    .deriveBundleMissingEvidence;
  const events = [
    {
      eventType: 'operation.started',
      operationId: ids.operationId,
      attemptId: ids.attemptId,
      payload: { operationKind: 'inference' },
    },
    {
      eventType: 'operation.finished',
      operationId: ids.operationId,
      attemptId: ids.attemptId,
      payload: {},
    },
  ];
  const known = {
    codeIdentityKnown: true,
    modelIdentityKnown: true,
    adapterIdentityKnown: true,
    promptIdentityKnown: true,
    runtimeIdentityKnown: true,
    toolIdentityKnown: true,
  };
  it('reports missing, incomplete or expired exchanges', () => {
    for (const artifacts of [
      [],
      [
        {
          kind: 'inference_exchange',
          producedByAttemptId: ids.attemptId,
          body: null,
        },
      ],
      [
        {
          kind: 'inference_exchange',
          producedByAttemptId: ids.attemptId,
          body: Buffer.from(
            JSON.stringify({
              ...exchange(),
              status: 'transport_error',
              response: null,
            }),
          ),
        },
      ],
    ]) {
      expect(derive(execution, events, artifacts, known)).toContain(
        `operation.${ids.operationId}.inferenceExchange`,
      );
    }
  });
  it.each(['summarize', 'ask', 'translate', 'future-operation'])(
    'checks evidence for %s through the operation kind',
    (taskType) => {
      const missing = derive(
        { ...execution, taskType },
        events,
        [
          {
            kind: 'inference_exchange',
            producedByAttemptId: ids.attemptId,
            body: Buffer.from(JSON.stringify(exchange())),
          },
        ],
        known,
      );
      expect(missing).toEqual(['environment.servedInferenceIdentity']);
    },
  );
});

describe('Authorized runtime template capture', () => {
  const template = 'PRIVATE_TEMPLATE_Ω {{ messages[0].content }}';
  const digest = canonicalHash(template);
  const runtime = () => ({
    schemaVersion: 'inference-runtime/1',
    ...ids,
    complete: true,
    calls: [
      {
        callIndex: 1,
        engine: { properties: { chatTemplateHash: digest } },
        adapter: null,
      },
    ],
    templates: { [digest]: template },
  });
  const validate = (
    value: any = runtime(),
    root: any = execution,
    current: any = step,
  ) =>
    assertInferenceRuntimeCapture(
      Buffer.from(JSON.stringify(value)),
      root,
      current,
      ids.attemptId,
    );

  it('accepts matching authorized template text as sensitive content', () => {
    expect(validate()).toBe(true);
  });
  it('allows body-free runtime metadata without a raw capture grant', () => {
    const value: any = runtime();
    delete value.templates;
    expect(validate(value, execution, { ...step, work: {} })).toBe(false);
  });
  it('rejects an absent grant, another owner or a foreign attempt', () => {
    expect(() => validate(runtime(), execution, { ...step, work: {} })).toThrow(
      'invalid_inference_runtime',
    );
    expect(() =>
      validate(runtime(), { ...execution, ownerPrincipal: '8' }),
    ).toThrow('invalid_inference_runtime');
    expect(() => validate({ ...runtime(), attemptId: ids.stepId })).toThrow(
      'invalid_inference_runtime',
    );
  });
  it('rejects changed text, unreferenced templates and oversized tables', () => {
    const changed: any = runtime();
    changed.templates[digest] = 'PRIVATE_CHANGED';
    const orphan: any = runtime();
    orphan.calls[0].engine.properties = {};
    const large: any = runtime();
    large.templates[digest] = 'X'.repeat(256 * 1024 + 1);
    for (const value of [changed, orphan, large]) {
      expect(() => validate(value)).toThrow('invalid_inference_runtime');
    }
  });
  it('rejects invalid structures without echoing their text', () => {
    for (const pool of [null, [], 'PRIVATE', { [digest]: '\ud800' }]) {
      expect(() => validate({ ...runtime(), templates: pool })).toThrow(
        'invalid_inference_runtime',
      );
    }
  });
});

describe('Browser inference uses the common capture authorization', () => {
  const models = {
    browserInference: jest
      .fn()
      .mockResolvedValue({ executionId: ids.executionId }),
  };
  const executions = {
    resolveAccessScope: jest.fn().mockReturnValue({ ownerPrincipal: '7' }),
  };
  const controller = new BrowserInferenceController(
    models as any,
    executions as any,
  );
  const request = {
    requestId: '11234567-89ab-4def-8123-456789abcdef',
    requestJson: '{"messages":[]}',
  };
  beforeEach(() => jest.clearAllMocks());

  it.each([undefined, 'true', 'false'])(
    'does not infer consent from %s',
    async (header) => {
      await controller.create(
        request,
        { userId: 7, permissions: { export: true } },
        header,
      );
      expect(models.browserInference).toHaveBeenCalledWith(
        request,
        { ownerPrincipal: '7' },
        false,
      );
    },
  );

  it.each([
    undefined,
    { userId: 7, permissions: {} },
    { userId: 7, permissions: { export: 'true' } },
  ])(
    'rejects a capture without authenticated export permission',
    async (user) => {
      await expect(controller.create(request, user, 'granted')).rejects.toThrow(
        ForbiddenException,
      );
      expect(models.browserInference).not.toHaveBeenCalled();
    },
  );

  it('authorizes capture for the authenticated owner with explicit consent', async () => {
    await controller.create(
      request,
      { userId: 7, permissions: { export: true } },
      'granted',
    );
    expect(models.browserInference).toHaveBeenCalledWith(
      request,
      { ownerPrincipal: '7' },
      true,
    );
  });
});
