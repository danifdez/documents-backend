import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = join(backendRoot, 'contracts/execution/v1');
const fixturesRoot = join(backendRoot, 'test/contracts/execution/v1/fixtures');
const write = process.argv.includes('--write');
const targets = process.argv
  .slice(2)
  .filter((argument) => argument !== '--write')
  .map((target) => {
    const separator = target.indexOf(':');
    const layout = separator === -1 ? 'documents' : target.slice(0, separator);
    const path = separator === -1 ? target : target.slice(separator + 1);
    if (!['documents', 'ai-train'].includes(layout)) {
      throw new Error(`Unsupported contract target layout: ${layout}`);
    }
    return { layout, root: resolve(backendRoot, path) };
  });

const walk = (root, predicate = () => true) =>
  readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory()
        ? walk(path, predicate)
        : predicate(path)
          ? [path]
          : [];
    })
    .sort();

const sha256 = (value) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(
      'Floating-point values are outside the canonical v1 profile',
    );
  }
  return value;
};

const canonicalHash = (value) => sha256(JSON.stringify(canonicalValue(value)));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const schemaFiles = walk(join(contractRoot, 'schemas'), (path) =>
  path.endsWith('.json'),
);
const schemas = schemaFiles.map((path) => ({
  path: relative(contractRoot, path).replaceAll('\\', '/'),
  sha256: sha256(readFileSync(path)),
}));
const manifestLines = schemas
  .map((entry) => `${entry.path}\0${entry.sha256}\n`)
  .join('');
const manifest = {
  manifestSchema: 'execution-contract-manifest/1',
  contractVersion: 'v1',
  contractSetHash: sha256(manifestLines),
  schemas,
};
const manifestPath = join(contractRoot, 'schema-manifest.json');
const validatorPath = join(contractRoot, 'validate.py');

const updateBundle = (path) => {
  const bundle = readJson(path);
  const artifacts = new Map(
    bundle.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  for (const artifact of bundle.artifacts) {
    if (!artifact.bundlePath) continue;
    const body = readFileSync(resolve(dirname(path), artifact.bundlePath));
    artifact.size = body.length;
    artifact.contentHash = sha256(body);
  }
  for (const event of bundle.events) {
    const snapshot = artifacts.get(event.payload?.snapshotArtifactId);
    if (snapshot) event.payload.contentHash = snapshot.contentHash;
    const { contentHash: _contentHash, ...withoutHash } = event;
    event.contentHash = canonicalHash(withoutHash);
  }
  bundle.integrity.eventsHash = canonicalHash(bundle.events);
  bundle.integrity.schemaManifestHash = manifest.contractSetHash;
  const { manifestHash: _manifestHash, ...withoutManifestHash } = bundle;
  bundle.manifestHash = canonicalHash(withoutManifestHash);
  writeJson(path, bundle);
};

const assertSame = (source, destination) => {
  if (!existsSync(destination))
    throw new Error(`Missing synchronized file: ${destination}`);
  if (!readFileSync(source).equals(readFileSync(destination))) {
    throw new Error(`Contract copy differs: ${destination}`);
  }
};

if (write) {
  writeJson(manifestPath, manifest);
  for (const path of walk(join(fixturesRoot, 'valid'), (item) =>
    item.endsWith('-bundle.json'),
  )) {
    updateBundle(path);
  }
} else if (
  JSON.stringify(readJson(manifestPath)) !== JSON.stringify(manifest)
) {
  throw new Error('schema-manifest.json does not match the canonical schemas');
}

for (const target of targets) {
  const contractPrefix =
    target.layout === 'ai-train' ? 'harness/contracts' : 'contracts';
  const targetContractRoot = join(target.root, contractPrefix, 'execution/v1');
  const targetFixturesRoot = join(
    target.root,
    'tests/contracts/execution/v1/fixtures',
  );
  const copies = [
    ...schemaFiles.map((source) => [
      source,
      join(targetContractRoot, relative(contractRoot, source)),
    ]),
    [manifestPath, join(targetContractRoot, 'schema-manifest.json')],
    [validatorPath, join(targetContractRoot, 'validate.py')],
    ...walk(fixturesRoot).map((source) => [
      source,
      join(targetFixturesRoot, relative(fixturesRoot, source)),
    ]),
  ];
  for (const [source, destination] of copies) {
    if (write) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    } else {
      assertSame(source, destination);
    }
  }
}

console.log(
  `${write ? 'Updated' : 'Verified'} ${schemas.length} canonical schemas at ${manifest.contractSetHash}`,
);
