import type { DB } from '@cubicecho/ravocal-db';
import type DataLoader from 'dataloader';
import { createRankedCountLoader } from '../votes/loaders.ts';

/** Per-request batching for the hand-written fields on list items, so a list costs one query and not one per row. */
export interface Loaders {
  /** `Vote.rankedCount`, by vote id. */
  rankedCount: DataLoader<string, number>;
}

/**
 * Builds one request's loaders. Each caches for that request only, and a write in it clears what it changed.
 *
 * @param db - The db.
 * @param userId - The caller, or null when nobody is signed in.
 * @returns The loaders.
 */
export function createLoaders(db: DB, userId: string | null): Loaders {
  return { rankedCount: createRankedCountLoader(db, userId) };
}
