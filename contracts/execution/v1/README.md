# Canonical execution contract v1

This directory contains the backend's pinned copy of the language-neutral
contract for durable executions.

## Layout

- `schemas/`: JSON Schema 2020-12 contracts.
- `schema-manifest.json`: SHA-256 inventory of every schema.

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

Unknown optional fields are accepted. Unknown schema versions and unknown
`payloadSchema` values are rejected explicitly.
