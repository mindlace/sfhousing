import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ui from './ui';
import { messageShape, SPACE_STEPS } from './ui';

const fromRoot = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const constants = (Object.entries(ui) as [string, unknown][]).filter(
  (e): e is [string, string] => typeof e[1] === 'string'
);
const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe('the shared parts', () => {
  it('every padding, margin and gap step in the constants is one of SPACE_STEPS', () => {
    expect(constants.length).toBeGreaterThanOrEqual(11);
    const allowed = new Set<string>(SPACE_STEPS.map(String));
    const bad: string[] = [];
    for (const [name, value] of constants) {
      for (const m of value.matchAll(
        /(?<![\w-])(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap)-(\d+(?:\.5)?)(?![\w.])/g
      )) {
        if (!allowed.has(m[1])) bad.push(`${name}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('BUTTON and BUTTON_PRIMARY: 24 px, 44 px on a coarse pointer; BUTTON_QUIET: 44 px', () => {
    for (const b of [ui.BUTTON, ui.BUTTON_PRIMARY]) {
      expect(classes(b)).toEqual(
        expect.arrayContaining([
          'min-h-6',
          'min-w-6',
          'pointer-coarse:min-h-11',
          'pointer-coarse:min-w-11'
        ])
      );
    }
    expect(classes(ui.BUTTON_QUIET)).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11']));
  });

  it('a disabled or aria-disabled button reads muted, with no hover and a not-allowed cursor', () => {
    for (const b of [ui.BUTTON, ui.BUTTON_PRIMARY]) {
      const c = classes(b);
      for (const state of ['disabled', 'aria-disabled']) {
        expect(c).toContain(`${state}:cursor-not-allowed`);
        expect(c).toContain(`${state}:text-ink-muted`);
        expect(c).toContain(`dark:${state}:text-ink-dark-muted`);
      }
    }
  });

  it('messageShape: "Some map data didn\'t load." is a chip; two sentences, nine words or details are a card', () => {
    expect(messageShape("Some map data didn't load.")).toBe('chip');
    expect(messageShape('Part of the simulation stopped.')).toBe('chip');
    expect(messageShape('One two three four five six seven eight.')).toBe('chip');
    expect(messageShape('One two three four five six seven eight nine.')).toBe('card');
    expect(messageShape('Saved. Reload to see it.')).toBe('card');
    expect(messageShape("Some map data didn't load.", true)).toBe('card');
  });

  it('every button kind shows the accent outline on focus-visible, in both themes', () => {
    for (const b of [ui.BUTTON, ui.BUTTON_PRIMARY, ui.BUTTON_QUIET]) {
      expect(classes(b)).toEqual(
        expect.arrayContaining([
          'focus-visible:outline-2',
          'focus-visible:outline-offset-1',
          'focus-visible:outline-accent',
          'dark:focus-visible:outline-accent-dark'
        ])
      );
    }
  });

  it("Explain's md tooltip draws SURFACE_TIP, class for class", () => {
    const explain = readFileSync(fromRoot('src/lib/timeline/Explain.svelte'), 'utf8');
    const attr = /role="tooltip"[^>]*?class="([^"]*)"/s.exec(explain)?.[1] ?? '';
    const tip = new Set(classes(attr));
    // text-sm applies at every width; the rest only where the text is a pop-over (md up), dark
    // partners as md:dark:.
    for (const c of classes(ui.SURFACE_TIP)) {
      const want = c === 'text-sm' ? c : `md:${c}`;
      expect(tip.has(want), want).toBe(true);
    }
    // Nothing else of the pop-over's look: no other md: radius, border, surface, ink or shadow.
    const look = /^md:(dark:)?(rounded|border|bg-|text-ink|shadow|px-|py-)/;
    const expected = new Set(classes(ui.SURFACE_TIP).map((c) => `md:${c}`));
    expect([...tip].filter((c) => look.test(c) && !expected.has(c))).toEqual([]);
  });

  it("layout.css's .explain-under draws SURFACE_TIP in CSS, light and dark", () => {
    const css = readFileSync(fromRoot('src/routes/layout.css'), 'utf8');
    expect(css).toMatch(/SURFACE_TIP/);
    const rules = [...css.matchAll(/\.explain-under \[role='tooltip'\] \{([^}]*)\}/g)].map(
      (m) => m[1]
    );
    const [light, dark] = rules;
    expect(light).toMatch(/padding: 0\.25rem 0\.5rem;/);
    expect(light).toMatch(/border: 1px solid var\(--color-line\);/);
    expect(light).toMatch(/border-radius: 0\.25rem;/);
    expect(light).toMatch(/background: var\(--color-surface\);/);
    expect(light).toMatch(/color: var\(--color-ink\);/);
    // Tailwind's shadow-md, both layers.
    expect(light.replace(/\s+/g, ' ')).toContain(
      'box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);'
    );
    // The dark half: SURFACE_TIP's dark: partners.
    expect(dark).toMatch(/border-color: var\(--color-line-dark\);/);
    expect(dark).toMatch(/background: var\(--color-surface-dark\);/);
    expect(dark).toMatch(/color: var\(--color-ink-dark\);/);
  });
});
