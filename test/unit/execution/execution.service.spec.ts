import {
  canonicalHash,
  canonicalJson,
  contentHash,
  redactExecutionText,
} from '../../../src/execution/execution.service';

describe('ExecutionService primitives', () => {
  it('canonicalizes object keys recursively', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });

  it('produces stable sha256 identifiers', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(contentHash('execution')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('redacts private reasoning and credentials', () => {
    const value = redactExecutionText(
      '<think>private</think> Authorization=secret Bearer abc.def',
    );
    expect(value).not.toContain('private');
    expect(value).not.toContain('secret');
    expect(value).not.toContain('abc.def');
  });
});
