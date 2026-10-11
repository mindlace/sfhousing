import type { Editor } from '$lib/brush/editor.svelte';
import { TITLE_MAX_CHARS, type Plan } from '$lib/plan';

/** Trim; empty becomes undefined; clip to TITLE_MAX_CHARS. */
export function normalizeTitle(t: string | undefined): string | undefined {
  const s = t?.trim();
  if (!s) return undefined;
  return s.length > TITLE_MAX_CHARS ? s.slice(0, TITLE_MAX_CHARS) : s;
}

/** Pure: returns a copy with the normalised title; the key is removed when undefined. */
export function withTitle(plan: Plan, title: string | undefined): Plan {
  const { title: _old, ...rest } = plan;
  void _old;
  const t = normalizeTitle(title);
  return t === undefined ? (rest as Plan) : { ...rest, title: t };
}

/** The ONLY place Editor.setTitle is called. */
export function applyTitle(editor: Pick<Editor, 'setTitle'>, title: string | undefined): void {
  editor.setTitle(normalizeTitle(title));
}
