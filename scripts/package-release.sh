#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$SERVICE_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/release/common.sh"

VERSION=""
TARGET=""
NODE_VERSION=""
STAGING=""
OUTPUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --node-version) NODE_VERSION="$2"; shift 2 ;;
    --staging) STAGING="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    *) die "Unknown Backend packaging argument: $1" 2 ;;
  esac
done

[ -n "$VERSION" ] && [ -n "$TARGET" ] && [ -n "$NODE_VERSION" ] && [ -n "$STAGING" ] && [ -n "$OUTPUT" ] ||
  die "Backend packaging requires --version, --target, --node-version, --staging and --output" 2
validate_semver "$VERSION"
assert_local_target "$TARGET"
assert_inside_workspace "$STAGING"
assert_inside_workspace "$OUTPUT"
require_command node
require_command npm
require_file "$SERVICE_DIR/package-lock.json"

ACTIVE_NODE="$(node -p 'process.versions.node')"
[ "$ACTIVE_NODE" = "$NODE_VERSION" ] || die "Backend must be packaged with Node $NODE_VERSION (current: $ACTIVE_NODE)" 3

rm -rf "$STAGING"
mkdir -p "$STAGING/bundle" "$OUTPUT/components" "$OUTPUT/.metadata/$TARGET" "$OUTPUT/logs"
LOG_FILE="$OUTPUT/logs/backend.log"

log_info "Installing and compiling Backend"
run_logged "$LOG_FILE" npm --prefix "$SERVICE_DIR" ci
run_logged "$LOG_FILE.contracts" npm --prefix "$SERVICE_DIR" run contracts:check:models
run_logged "$LOG_FILE.build" npm --prefix "$SERVICE_DIR" run build

BUNDLE="$STAGING/bundle"
cp -a "$SERVICE_DIR/dist" "$BUNDLE/dist"
cp "$SERVICE_DIR/package.json" "$SERVICE_DIR/package-lock.json" "$BUNDLE/"
cp -a "$SERVICE_DIR/contracts" "$BUNDLE/contracts"
[ -d "$SERVICE_DIR/data" ] && cp -a "$SERVICE_DIR/data" "$BUNDLE/dist/data"

log_info "Installing Backend production dependencies"
mkdir -p "$BUNDLE/runtime/puppeteer"
PUPPETEER_CACHE_DIR="$BUNDLE/runtime/puppeteer" run_logged "$LOG_FILE.dependencies" npm --prefix "$BUNDLE" ci --omit=dev

REVISION="$(git_revision "$SERVICE_DIR")"
node - "$BUNDLE/component-manifest.json" "$VERSION" "$TARGET" "$REVISION" "$NODE_VERSION" <<'NODE'
import fs from 'node:fs';
const [, , file, version, target, revision, nodeVersion] = process.argv;
const manifest = {
  schemaVersion: 1,
  component: 'backend',
  version,
  target,
  entrypoint: 'dist/src/main.js',
  source: { repository: 'backend', revision },
  runtime: { node: nodeVersion },
  requires: { postgres: true, extensions: ['vector', 'age'] },
  createdAt: new Date().toISOString(),
};
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

log_info "Running Backend bundle smoke test"
run_logged "$LOG_FILE.smoke" node "$SERVICE_DIR/scripts/smoke-release.mjs" "$BUNDLE"

EXT="tar.gz"
if [[ "$TARGET" == win32-* ]]; then EXT="zip"; fi
NAME="documents-backend-v${VERSION}-${TARGET}.${EXT}"
ARTIFACT="$OUTPUT/components/$NAME"
if [ "$EXT" = "zip" ]; then
  require_command zip
  (cd "$BUNDLE" && zip -qr "$ARTIFACT" .)
else
  tar czf "$ARTIFACT" -C "$BUNDLE" .
fi

node - "$OUTPUT/.metadata/$TARGET/backend.json" "$VERSION" "$TARGET" "components/$NAME" "$NODE_VERSION" <<'NODE'
import fs from 'node:fs';
const [, , file, version, target, artifact, nodeVersion] = process.argv;
fs.writeFileSync(file, `${JSON.stringify({
  component: 'backend', version, target, artifact,
  runtime: { node: nodeVersion },
  requires: { postgres: true, extensions: ['vector', 'age'] },
}, null, 2)}\n`);
NODE

log_info "Backend artifact created: $ARTIFACT"
