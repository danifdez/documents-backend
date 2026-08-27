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

function requireMatch(pattern, file, message) {
  if (!existsSync(file) || !pattern.test(readFileSync(file, 'utf8'))) {
    failures.push(`${message}: ${file}`);
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
reject(
  /\b(?:evaluate|runEvaluation|scoreEvaluation|EvaluationService|EvaluationRunner)\b/,
  backendRuntime,
  'Backend runtime contains evaluation ownership',
);
reject(
  /\b(?:LLAMA_SERVER_URL|InferenceModule|InferenceService)\b/,
  [...backendRuntime, join(backend, '.env.example')],
  'Backend contains IA Browser inference-engine handoff',
);

const backendMigrations = sourceFiles(join(backend, 'migrations'), ['.ts']);
reject(
  /\bTRUNCATE\s+TABLE\b/i,
  backendMigrations,
  'Alpha baseline contains a data-transition migration',
);
reject(
  /\b(?:assistant_memory_entries|memory_vectors|ReplaceAssistantMemory)\b/,
  backendMigrations,
  'Alpha baseline contains replaced memory schema',
);

const browserProductRuntime = [
  ...browserRuntime,
  ...sourceFiles(join(browser, 'resources'), ['.js', '.html', '.css']),
  join(browser, 'CMakeLists.txt'),
];
reject(
  /\b(?:SyncSharedEngine|DropSharedEngine|UseShared|ReleaseShared|shared_inference_|awaiting_shared_|shared_model_)\b|shared_engine\.(?:cc|h)/,
  browserProductRuntime,
  'IA Browser contains Backend-owned inference-engine handoff',
);
requireMatch(
  /@Controller\('browser-inference'\)/,
  join(backend, 'src', 'model', 'browser-inference.controller.ts'),
  'Backend-owned browser inference route is missing',
);
requireMatch(
  /@execution_handler\("browser-inference"\)/,
  join(models, 'tasks', 'browser_inference', 'browser_inference.py'),
  'Models browser inference handler is missing',
);
requireMatch(
  /g_backend_connected[\s\S]*StartDocuments/,
  join(browser, 'src', 'ai', 'llama_client.cc'),
  'Connected IA Browser does not route inference through Backend',
);
requireMatch(
  /ConfigureBackendInferenceTransport\(/,
  join(browser, 'src', 'docs_client.cc'),
  'IA Browser does not bind inference transport to Documents',
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
