// Match the original default sort order across locales and runtimes.
export function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
