// Each claim starts only when the consumer advances the iterator.
export async function* claimAvailable<T>(
  claim: () => Promise<T | null | undefined>,
  limit = Infinity,
): AsyncGenerator<T> {
  async function* claims(): AsyncGenerator<T | null | undefined> {
    for (let index = 0; index < limit; index += 1) {
      yield claim();
    }
  }

  for await (const item of claims()) {
    if (item == null) return;
    yield item;
  }
}
