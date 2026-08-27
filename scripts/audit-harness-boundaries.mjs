import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const models = resolve(backend, '..', 'models');
const browser = resolve(backend, '..', '..', 'ia-browser');
const aiTrain = resolve(backend, '..', '..', 'ai-train');
const failures = [];

function sourceFiles(root, extensions) {
  const files = [];
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root)) {
    if (
      entry === '__pycache__' ||
      entry === 'node_modules' ||
      entry === 'build'
    ) {
      continue;
    }
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path, extensions));
    } else if (extensions.some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }
  return files;
}

function reject(pattern, files, message) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (pattern.test(content)) failures.push(`${message}: ${file}`);
  }
}

const modelRuntime = [
  join(models, 'executions.py'),
  ...['common', 'lib', 'worker', 'utils', 'tasks', 'services', 'rag'].flatMap(
    (directory) => sourceFiles(join(models, directory), ['.py']),
  ),
];
reject(
  /\b(?:psycopg|asyncpg|sqlalchemy|typeorm)\b|\bPOSTGRES_[A-Z_]+\b/i,
  modelRuntime,
  'Models runtime contains database access',
);
reject(
  /(?:evaluate|evaluation_run|metric_evidence|training_run)\s*\(/i,
  modelRuntime,
  'Models runtime contains evaluation ownership',
);

const browserRuntime = sourceFiles(join(browser, 'src'), ['.cc', '.h']);
reject(
  /\/models-work(?:\/|\")/,
  browserRuntime,
  'IA Browser calls the Models worker protocol',
);

const executionEntity = readFileSync(
  join(backend, 'src', 'execution', 'execution.entity.ts'),
  'utf8',
);
for (const field of [
  'claimedBy',
  'attemptId',
  'leaseExpiresAt',
  'technicalResult',
]) {
  if (new RegExp(`\\b${field}\\b`).test(executionEntity)) {
    failures.push(`Canonical execution contains technical field: ${field}`);
  }
}

const backendRuntime = sourceFiles(join(backend, 'src'), ['.ts']);
reject(
  /FEATURE_(?:LEGACY_)?EXECUTION_HARNESS|legacyExecution/i,
  backendRuntime,
  'Backend contains a second or legacy harness path',
);

for (const required of [
  join(aiTrain, 'harness', 'offline_evaluation.py'),
  join(aiTrain, 'harness', 'evaluation_contract.py'),
  join(aiTrain, 'web', 'runs.py'),
]) {
  if (!existsSync(required))
    failures.push(`ai-train evaluator missing: ${required}`);
}

const modelEvaluators = sourceFiles(join(models, 'evals'), ['.py']);
if (modelEvaluators.length) {
  failures.push(
    `Models contains evaluator source: ${modelEvaluators.join(', ')}`,
  );
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Execution harness boundaries are canonical.\n');
}
