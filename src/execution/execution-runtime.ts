import { canonicalHash } from './execution-canonical';

export const BACKEND_RUNTIME_FINGERPRINT = canonicalHash({
  kind: 'node',
  platform: process.platform,
  architecture: process.arch,
  node: process.versions.node,
  modules: process.versions.modules,
  napi: process.versions.napi,
  uv: process.versions.uv,
  v8: process.versions.v8,
  openssl: process.versions.openssl,
});
