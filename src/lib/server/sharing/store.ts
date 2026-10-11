// D1 access for published plans. Rows are insert-only.
import { eq } from 'drizzle-orm';
import type { getDb } from '$lib/server/db';
import { plan, type PlanRow } from '$lib/server/db/schema';

type Db = ReturnType<typeof getDb>;

export async function findPlanById(db: Db, id: string): Promise<PlanRow | undefined> {
  return db.select().from(plan).where(eq(plan.id, id)).get();
}

export async function findPlanByHash(db: Db, hash: string): Promise<PlanRow | undefined> {
  return db.select().from(plan).where(eq(plan.contentHash, hash)).get();
}

/** true = inserted; false = a PK or content_hash conflict left the table unchanged. */
export async function insertPlan(db: Db, row: PlanRow): Promise<boolean> {
  const res = await db.insert(plan).values(row).onConflictDoNothing().run();
  return res.meta.changes > 0;
}
