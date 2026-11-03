import { describe, expect, it } from 'vitest';
import { DockState } from './dock-state.svelte';

describe('DockState', () => {
  it('starts on the editing face, its sheet closed, the panel as asked', () => {
    const d = new DockState({ tab: 'transit' });
    expect([d.face, d.tab, d.open, d.sheet]).toEqual(['edit', 'transit', true, 'closed']);
    expect(new DockState({ tab: 'transit', open: false }).open).toBe(false);
  });

  it('showResults opens the panel and lifts a closed sheet to peek; showEdit restores the tab', () => {
    const d = new DockState({ tab: 'transit', open: false });
    d.tab = 'permits';
    d.showResults();
    expect([d.face, d.open, d.sheet]).toEqual(['results', true, 'peek']);
    d.showEdit();
    expect([d.face, d.tab, d.sheet]).toEqual(['edit', 'permits', 'full']);
  });

  it('showResults leaves a full sheet full; showEdit(tab) changes the tab and leaves a closed sheet closed', () => {
    const d = new DockState({ tab: 'transit' });
    d.sheet = 'full';
    d.showResults();
    expect(d.sheet).toBe('full');
    d.sheet = 'closed';
    d.showEdit('protect');
    expect([d.face, d.tab, d.sheet]).toEqual(['edit', 'protect', 'closed']);
  });

  it('toggleResults flips the face, and opens a hidden dock on Results', () => {
    const d = new DockState({ tab: 'transit', open: false });
    d.toggleResults(true);
    expect([d.face, d.open]).toEqual(['results', true]);
    d.toggleResults(true);
    expect(d.face).toBe('edit');
    d.toggleResults(true);
    expect(d.face).toBe('results');

    const p = new DockState({ tab: 'transit' });
    p.toggleResults(false);
    expect([p.face, p.sheet]).toEqual(['results', 'peek']);
    p.toggleResults(false);
    expect([p.face, p.sheet]).toEqual(['edit', 'full']);
  });

  it('toggleResults on a hidden dock already on Results keeps Results and shows it', () => {
    const d = new DockState({ tab: 'transit', open: false });
    d.face = 'results';
    d.toggleResults(true);
    expect([d.face, d.open]).toEqual(['results', true]);
  });

  it('toggleOpen: desktop open <-> rail; phone closed <-> full', () => {
    const d = new DockState({ tab: 'transit' });
    d.toggleOpen(true);
    expect([d.open, d.sheet]).toEqual([false, 'closed']);
    d.toggleOpen(true);
    expect(d.open).toBe(true);
    d.toggleOpen(false);
    expect([d.open, d.sheet]).toEqual([true, 'full']);
    d.toggleOpen(false);
    expect(d.sheet).toBe('closed');
    d.sheet = 'peek';
    d.toggleOpen(false);
    expect(d.sheet).toBe('closed');
  });

  it('visible follows the width', () => {
    const d = new DockState({ tab: 'transit', open: true });
    expect([d.visible(true), d.visible(false)]).toEqual([true, false]);
    d.open = false;
    d.sheet = 'peek';
    expect([d.visible(true), d.visible(false)]).toEqual([false, true]);
  });

  it('widthChanged carries an open sheet to the desktop panel, and leaves the rest alone', () => {
    const d = new DockState({ tab: 'permits', open: false });
    d.sheet = 'full';
    d.widthChanged(true);
    expect(d.open).toBe(true);
    const r = new DockState({ tab: 'permits', open: false });
    r.widthChanged(true);
    expect(r.open).toBe(false);
    const w = new DockState({ tab: 'permits', open: true });
    w.widthChanged(false);
    expect([w.open, w.sheet]).toEqual([true, 'closed']);
  });
});
