import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { EXECUTION_CONTRACT_SET_HASH } from '../../../src/execution/execution.constants';

const root = resolve(__dirname, '../../../contracts/execution/v1');
const schemasRoot = join(root, 'schemas');
const fixturesRoot = resolve(
  __dirname,
  '../../contracts/execution/v1/fixtures',
);

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (value: Buffer | string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

function canonicalValue(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error('floats are outside the canonical profile');
  }
  return value;
}

const canonicalHash = (value: any) =>
  sha256(JSON.stringify(canonicalValue(value)));

function schemaPaths(path = schemasRoot): string[] {
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory()
        ? schemaPaths(child)
        : entry.name.endsWith('.json')
          ? [child]
          : [];
    })
    .sort();
}

function verifyManifest(): string {
  const entries = schemaPaths().map((path) => ({
    path: path.slice(root.length + 1).replaceAll('\\', '/'),
    sha256: sha256(readFileSync(path)),
  }));
  const lines = entries
    .map((entry) => `${entry.path}\0${entry.sha256}\n`)
    .join('');
  const expected = {
    manifestSchema: 'execution-contract-manifest/1',
    contractVersion: 'v1',
    contractSetHash: sha256(lines),
    schemas: entries,
  };
  expect(readJson(join(root, 'schema-manifest.json'))).toEqual(expected);
  return expected.contractSetHash;
}

function applyMutations(value: any, mutations: any[]): any {
  const result = structuredClone(value);
  for (const mutation of mutations) {
    const parts = mutation.path
      .slice(1)
      .split('/')
      .map((part: string) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    const key = parts.pop()!;
    const parent = parts.reduce(
      (current: any, part: string) =>
        current[Array.isArray(current) ? Number(part) : part],
      result,
    );
    if (mutation.op === 'remove') {
      if (Array.isArray(parent)) {
        parent.splice(Number(key), 1);
      } else {
        delete parent[key];
      }
    } else if (mutation.op === 'replace' || mutation.op === 'add') {
      parent[Array.isArray(parent) ? Number(key) : key] = mutation.value;
    } else {
      throw new Error(`unsupported mutation ${mutation.op}`);
    }
  }
  return result;
}

function assertInvariants(
  bundle: any,
  bundlePath: string,
  contractHash: string,
): void {
  const events = bundle.events;
  const artifacts = new Map(
    bundle.artifacts.map((item: any) => [item.artifactId, item]),
  );
  const eventIds = new Set<string>();
  const producers = new Map<string, number>();
  const operations = new Map<string, any>();
  const finished = new Set<string>();
  const expectedSequences = Array.from(
    {
      length:
        bundle.eventRange.lastSequence - bundle.eventRange.firstSequence + 1,
    },
    (_, index) => bundle.eventRange.firstSequence + index,
  );
  expect(events.map((event: any) => event.sequence)).toEqual(expectedSequences);

  for (const event of events) {
    expect(event.rootExecutionId).toBe(bundle.rootExecutionId);
    if (event.causedByEventId)
      expect(eventIds.has(event.causedByEventId)).toBe(true);
    eventIds.add(event.eventId);
    const producerKey = `${event.producer.component}\0${event.producer.instanceId}`;
    expect(event.producerSequence).toBeGreaterThan(
      producers.get(producerKey) ?? 0,
    );
    producers.set(producerKey, event.producerSequence);
    for (const artifactId of event.artifactRefs)
      expect(artifacts.has(artifactId)).toBe(true);
    const { contentHash, ...withoutHash } = event;
    expect(contentHash).toBe(canonicalHash(withoutHash));
    const operationKey = `${event.operationId}\0${event.attemptId}`;
    if (event.eventType === 'operation.started')
      operations.set(operationKey, event);
    if (event.eventType === 'operation.finished') {
      expect(operations.has(operationKey)).toBe(true);
      expect(finished.has(operationKey)).toBe(false);
      expect(operations.get(operationKey).payload.operationKind).toBe(
        event.payload.operationKind,
      );
      finished.add(operationKey);
    }
  }

  const required = new Set([
    'execution.created',
    'execution.state_changed',
    'operation.started',
    'operation.finished',
    'message.recorded',
    'source.observed',
  ]);
  for (const event of events) required.delete(event.eventType);
  expect([...required]).toEqual([]);
  if (bundle.bundleCompleteness.status === 'reproducible') {
    expect([...operations.keys()].filter((key) => !finished.has(key))).toEqual(
      [],
    );
  }
  const terminal = events.filter(
    (event: any) =>
      event.eventType === 'execution.state_changed' &&
      ['completed', 'failed', 'cancelled'].includes(event.payload.to),
  );
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toBe(events.at(-1));

  for (const artifact of bundle.artifacts) {
    if (!artifact.bundlePath) continue;
    const body = readFileSync(resolve(bundlePath, '..', artifact.bundlePath));
    expect(artifact.size).toBe(body.length);
    expect(artifact.contentHash).toBe(sha256(body));
  }
  expect(bundle.integrity.schemaManifestHash).toBe(contractHash);
  expect(bundle.integrity.eventsHash).toBe(canonicalHash(events));
  const { manifestHash, ...withoutManifestHash } = bundle;
  expect(manifestHash).toBe(canonicalHash(withoutManifestHash));
}

describe('execution v1 contract', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const path of schemaPaths()) ajv.addSchema(readJson(path));
  const validate = ajv.getSchema(
    'https://documents.local/harness/v1/schemas/execution-bundle.schema.json',
  )!;
  const contractHash = verifyManifest();

  it('keeps the runtime adapter pinned to the copied schema set', () => {
    expect(contractHash).toBe(EXECUTION_CONTRACT_SET_HASH);
  });

  it.each(['documents-bundle.json', 'ia-browser-bundle.json'])(
    'accepts %s with valid hashes and invariants',
    (name) => {
      const path = join(fixturesRoot, 'valid', name);
      const bundle = readJson(path);
      if (!validate(bundle)) throw new Error(JSON.stringify(validate.errors));
      assertInvariants(bundle, path, contractHash);
    },
  );

  it.each(readdirSync(join(fixturesRoot, 'invalid')).sort())(
    'rejects %s',
    (name) => {
      const fixture = readJson(join(fixturesRoot, 'invalid', name));
      const basePath = resolve(fixturesRoot, 'invalid', fixture.base);
      const bundle = applyMutations(readJson(basePath), fixture.mutations);
      const schemaValid = validate(bundle);
      if (fixture.expectedFailure === 'schema') expect(schemaValid).toBe(false);
      else {
        if (!schemaValid) throw new Error(JSON.stringify(validate.errors));
        expect(() =>
          assertInvariants(bundle, basePath, contractHash),
        ).toThrow();
      }
    },
  );

  it('ignores an unknown optional field', () => {
    const bundle = readJson(
      join(fixturesRoot, 'valid', 'documents-bundle.json'),
    );
    bundle.optionalExtension = { producerHint: 'future' };
    if (!validate(bundle)) throw new Error(JSON.stringify(validate.errors));
  });
});
