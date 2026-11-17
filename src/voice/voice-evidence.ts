import { BadRequestException } from '@nestjs/common';
import { canonicalHash } from '../execution/execution-canonical';

function reject(): never {
  throw new BadRequestException('Invalid voice evidence');
}
function keys(value: any, required: string[], optional: string[] = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    reject();
}
function integer(value: any, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) reject();
}
function hash(value: any) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value))
    reject();
}
function word(value: any) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.+-]{1,64}$/.test(value))
    reject();
}
function files(values: any, field: 'name' | 'role', allowed: string[]) {
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > allowed.length ||
    new Set(values.map((v) => v?.[field])).size !== values.length
  )
    reject();
  for (const value of values) {
    keys(value, [field, 'sha256', 'size']);
    if (!allowed.includes(value[field])) reject();
    hash(value.sha256);
    integer(value.size);
  }
}

/** Voice-specific shape; persistence and ownership remain in the stream service. */
export function assertVoiceEvidence(kind: string, value: any): void {
  if (kind === 'stream_runtime') {
    keys(value, [
      'schemaVersion',
      'model',
      'engine',
      'decoder',
      'requested',
      'codeFingerprint',
      'runtimeFingerprint',
      'omissions',
    ]);
    if (value.schemaVersion !== 'voice-runtime/1') reject();
    keys(value.model, ['sha256', 'files']);
    hash(value.model.sha256);
    files(value.model.files, 'name', [
      'config.json',
      'model.bin',
      'tokenizer.json',
      'preprocessor_config.json',
      'vocabulary.json',
      'vocabulary.txt',
    ]);
    if (
      !['config.json', 'model.bin', 'tokenizer.json'].every((name) =>
        value.model.files.some((f) => f.name === name),
      ) ||
      value.model.sha256 !== canonicalHash(value.model.files)
    )
      reject();
    keys(value.engine, [
      'name',
      'packages',
      'modules',
      'device',
      'computeType',
      'deviceIndex',
    ]);
    if (
      value.engine.name !== 'faster-whisper' ||
      !['cpu', 'cuda', 'mps'].includes(value.engine.device)
    )
      reject();
    word(value.engine.computeType);
    keys(value.engine.packages, ['faster-whisper', 'ctranslate2', 'av']);
    Object.values(value.engine.packages).forEach(word);
    files(value.engine.modules, 'role', ['wrapper', 'engine']);
    if (
      value.engine.modules.length !== 2 ||
      !Array.isArray(value.engine.deviceIndex) ||
      !value.engine.deviceIndex.length ||
      value.engine.deviceIndex.length > 16
    )
      reject();
    value.engine.deviceIndex.forEach((index) => integer(index, 63));
    keys(value.decoder, [
      'name',
      'sha256',
      'sampleRate',
      'channels',
      'sampleWidth',
    ]);
    if (
      value.decoder.name !== 'ffmpeg' ||
      value.decoder.sampleRate !== 16000 ||
      value.decoder.channels !== 1 ||
      value.decoder.sampleWidth !== 2
    )
      reject();
    hash(value.decoder.sha256);
    hash(value.codeFingerprint);
    hash(value.runtimeFingerprint);
    keys(value.requested, ['device', 'computeType']);
    word(value.requested.device);
    word(value.requested.computeType);
    if (
      JSON.stringify(value.omissions) !==
      JSON.stringify(['engine.unreported_generation_defaults'])
    )
      reject();
    return;
  }
  if (kind !== 'stream_inference') reject();
  const common = [
    'schemaVersion',
    'index',
    'phase',
    'runtimeHash',
    'input',
    'final',
    'startedAt',
  ];
  if (!['started', 'completed', 'failed'].includes(value?.phase)) reject();
  keys(value, [
    ...common,
    ...(value.phase === 'completed'
      ? [
          'decoded',
          'decodeUs',
          'inferenceUs',
          'parameters',
          'audioDurationUs',
          'audioAfterVadUs',
          'text',
          'finishedAt',
        ]
      : value.phase === 'failed'
        ? ['errorCode', 'finishedAt']
        : []),
  ]);
  if (value.schemaVersion !== 'voice-call/1') reject();
  integer(value.index, 128);
  if (!value.index || typeof value.final !== 'boolean') reject();
  hash(value.runtimeHash);
  keys(value.input, ['sha256', 'bytes', 'chunks']);
  hash(value.input.sha256);
  integer(value.input.bytes, 32 * 1024 * 1024);
  integer(value.input.chunks, 4096);
  if (!value.input.bytes || !value.input.chunks) reject();
  for (const name of [
    'startedAt',
    ...(value.phase === 'started' ? [] : ['finishedAt']),
  ]) {
    if (
      typeof value[name] !== 'string' ||
      value[name].length > 40 ||
      !/(Z|[+-]\d\d:\d\d)$/.test(value[name]) ||
      !Number.isFinite(Date.parse(value[name]))
    )
      reject();
  }
  if (
    value.phase !== 'started' &&
    Date.parse(value.finishedAt) < Date.parse(value.startedAt)
  )
    reject();
  if (value.phase === 'failed' && value.errorCode !== 'voice_processing_failed')
    reject();
  if (value.phase === 'completed') {
    keys(value.decoded, [
      'sha256',
      'samples',
      'sampleRate',
      'channels',
      'sampleWidth',
    ]);
    hash(value.decoded.sha256);
    integer(value.decoded.samples, 32 * 1024 * 1024);
    if (
      value.decoded.sampleRate !== 16000 ||
      value.decoded.channels !== 1 ||
      value.decoded.sampleWidth !== 2
    )
      reject();
    for (const name of [
      'decodeUs',
      'inferenceUs',
      'audioDurationUs',
      'audioAfterVadUs',
    ])
      integer(value[name]);
    keys(value.parameters, [
      'beamSize',
      'vadFilter',
      'conditionOnPreviousText',
    ]);
    integer(value.parameters.beamSize, 64);
    if (
      !value.parameters.beamSize ||
      typeof value.parameters.vadFilter !== 'boolean' ||
      typeof value.parameters.conditionOnPreviousText !== 'boolean' ||
      typeof value.text !== 'string' ||
      Buffer.byteLength(value.text) > 16 * 1024
    )
      reject();
  }
}
