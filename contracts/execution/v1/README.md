# Canonical execution contract v1

This directory is the canonical source of the language-neutral contract for
durable executions. Consumers keep pinned copies generated from this source;
contract schemas must not be edited in those copies.

## Layout

- `schemas/`: JSON Schema 2020-12 contracts.
- `schema-manifest.json`: SHA-256 inventory of every schema.
- `validate.py`: shared fixture and cross-record invariant validator.

Conformance fixtures live in `test/contracts/execution/v1/fixtures/` and are
validated by `test/unit/execution/contract-conformance.spec.ts`.

## Integrity rules

Hashes use lowercase SHA-256 with the `sha256:` prefix.

- Artifact hashes cover the exact bytes at `bundlePath`.
- Event hashes cover the event object without `contentHash`.
- `eventsHash` covers the canonical event array, including event hashes.
- `manifestHash` covers the complete bundle object without `manifestHash`.
- `contractSetHash` covers sorted lines of `<path>\0<sha256>\n` from the
  schema manifest.

Canonical JSON is UTF-8 JSON with object keys sorted lexicographically, no
insignificant whitespace, and non-ASCII characters preserved. The v1 hashed
surface rejects floating-point numbers; durations and usage values use integer
units or the string `unknown`. This constrained profile is intentionally easy
to reproduce in TypeScript, Python, and C++.

Run the backend conformance suite:

```bash
npm test -- --runInBand test/unit/execution/contract-conformance.spec.ts
```

Verify the manifest after an edit, then regenerate hashes and synchronize the
Models copy from the Documents monorepo:

```bash
npm run contracts:check
npm run contracts:sync:models
npm run contracts:check:models
npm run contracts:sync:all
npm run contracts:check:all
```

The sync command updates only the contract schemas, manifest, and shared
fixtures. `contracts:sync:all` publishes the same set to Models, IA Browser,
and ai-train from the standard sibling-repository layout.

Unknown optional fields are accepted. Unknown schema versions and unknown
`payloadSchema` values are rejected explicitly.
