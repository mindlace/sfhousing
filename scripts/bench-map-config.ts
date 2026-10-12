/** Benchmark-only selection. Never interpolate unchecked input into the server command. */
export function benchDataset(value: string | undefined): string {
  if (value === undefined) return 'fixture-0';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value))
    throw new Error('Invalid BENCH_DATASET_VERSION');
  return value;
}
