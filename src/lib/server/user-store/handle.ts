import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';
import type { Database } from '$lib/server/db';
import { isHandleAvailable } from './profile';
import { skeleton } from './confusable-skeleton';

const DICT = {
  dictionaries: [adjectives, colors, animals],
  separator: '-',
  length: 1,
  style: 'lowerCase' as const
};

function whimsical(rng?: () => string): string {
  return rng ? rng() : uniqueNamesGenerator(DICT);
}

function firstWordSlug(title: string): string | null {
  const m = title.toLowerCase().match(/[a-z0-9]+/);
  return m ? m[0] : null;
}

export function seedHandle(title: string, rng?: () => string): string {
  const base = firstWordSlug(title);
  return base ? `${base}-${whimsical(rng)}` : `${whimsical(rng)}-${whimsical(rng)}`;
}

export async function generateUniqueHandle(args: {
  db: Database;
  seedText?: string;
  rng?: () => string;
  now?: Date;
}): Promise<string> {
  const now = args.now ?? new Date();
  const title = args.seedText ?? '';
  let candidate = seedHandle(title, args.rng);
  for (let i = 0; i < 100; i++) {
    if (await isHandleAvailable(args.db, skeleton(candidate), now)) return candidate;
    candidate = `${candidate}-${whimsical(args.rng)}`; // grow on collision
  }
  throw new Error('Failed to generate a unique handle after maximum attempts');
}
