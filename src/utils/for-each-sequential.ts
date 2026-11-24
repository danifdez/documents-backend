// Use for ordered effects, such as writes through a transaction or operations
// whose resource locks must be acquired in a deterministic order.
export async function forEachSequential<T>(
  values: Iterable<T>,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  const iterator = values[Symbol.iterator]();
  // Adapt the iterator without resolving promise-valued inputs.
  const inputs: AsyncIterable<T> = {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve(iterator.next()),
      return: () =>
        Promise.resolve(
          iterator.return?.() ?? { done: true, value: undefined },
        ),
    }),
  };

  for await (const value of inputs) {
    await visit(value);
  }
}
