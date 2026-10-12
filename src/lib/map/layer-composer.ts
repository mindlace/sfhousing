import type { Layer } from '@deck.gl/core';

/** Owns the overlay's three ordered slots. Nested transactions publish only the final state. */
export class LayerComposer {
  private observed?: {
    publications: number;
    roofs: { id: string; active: boolean }[];
    maxRoofs: number;
    duplicatePublications: number;
  };
  private roofs: Layer[] = [];
  private generated: Layer[] = [];
  private brush: Layer[] = [];
  private depth = 0;
  private dirty = false;
  private destroyed = false;

  constructor(private setLayers: (layers: Layer[]) => void) {}

  setRoofs(layers: Layer[]): void {
    if (this.destroyed) return;
    this.roofs = [...layers];
    this.changed();
  }
  setGenerated(layers: Layer[]): void {
    if (this.destroyed) return;
    this.generated = [...layers];
    this.changed();
  }
  setBrush(layers: Layer[]): void {
    if (this.destroyed) return;
    this.brush = [...layers];
    this.changed();
  }
  transaction(fn: () => void): void {
    if (this.destroyed) return;
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
      this.flush();
    }
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.roofs = this.generated = this.brush = [];
    this.dirty = false;
    this.publish([]);
  }
  snapshot() {
    return import.meta.env.VITE_E2E === '1'
      ? (this.observed ?? { publications: 0, roofs: [], maxRoofs: 0, duplicatePublications: 0 })
      : null;
  }
  private publish(layers: Layer[]) {
    this.setLayers(layers);
    if (import.meta.env.VITE_E2E === '1') {
      const roofs = layers
        .filter((layer) => layer.id.startsWith('existing-roof-'))
        .map((layer) => ({
          id: layer.id,
          active: (layer.props as { active?: boolean }).active === true
        }));
      this.observed = {
        maxRoofs: Math.max(this.observed?.maxRoofs ?? 0, roofs.length),
        duplicatePublications:
          (this.observed?.duplicatePublications ?? 0) +
          (new Set(roofs.map((r) => r.id)).size === roofs.length ? 0 : 1),
        publications: (this.observed?.publications ?? 0) + 1,
        roofs
      };
    }
  }
  private changed(): void {
    this.dirty = true;
    this.flush();
  }
  private flush(): void {
    if (!this.dirty || this.depth || this.destroyed) return;
    this.dirty = false;
    this.publish([...this.roofs, ...this.generated, ...this.brush]);
  }
}
