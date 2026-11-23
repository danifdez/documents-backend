// Use for ordered effects, such as writes through a transaction or operations
// whose resource locks must be acquired in a deterministic order.
export async function forEachSequential<T>(
  values: Iterable<T>,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  async function* operations(): AsyncGenerator<void> {
    for (const value of values) {
      yield visit(value);
    }
  }

  for await (const _ of operations()) {
    // Drain the iterator. Each operation must settle before the next starts.
  }
}
