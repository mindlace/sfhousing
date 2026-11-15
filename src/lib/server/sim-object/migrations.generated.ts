// GENERATED — DO NOT EDIT. Regenerate via your migration generate command.
// Maps each migrations/sim/<name>/migration.sql to its SQL, keyed by the
// timestamp-prefixed migration name the durable-sqlite migrator expects.
export const simMigrations: Record<string, string> = {
  '20261115062714_fat_scorpion':
    'CREATE TABLE `commits` (\n\t`seq` integer PRIMARY KEY,\n\t`id` text NOT NULL UNIQUE,\n\t`hash` text NOT NULL,\n\t`bytes` integer NOT NULL,\n\t`body` text NOT NULL\n);\n--> statement-breakpoint\nCREATE TABLE `sim_state` (\n\t`id` integer PRIMARY KEY,\n\t`indexed_seq` integer DEFAULT 0 NOT NULL,\n\t`gone_at` integer\n);\n'
};
