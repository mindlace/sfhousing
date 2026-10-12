import type { Layer } from '@deck.gl/core';

/** Owns the overlay's three ordered slots. Nested transactions publish only the final state. */
export class LayerComposer {
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
    this.setLayers([]);
  }
  private changed(): void {
    this.dirty = true;
    this.flush();
  }
  private flush(): void {
    if (!this.dirty || this.depth || this.destroyed) return;
    this.dirty = false;
    this.setLayers([...this.roofs, ...this.generated, ...this.brush]);
  }
}
