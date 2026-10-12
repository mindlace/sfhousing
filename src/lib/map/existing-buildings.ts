import type { ParcelId } from '$lib/data/parcel';

export type ExistingBuildingState = { replaced?: boolean; roofReady?: boolean };
export type ReplacementChange = {
  /** Live readonly mirror; use `changed` to update only affected roof pieces. */
  hidden: ReadonlySet<ParcelId>;
  changed: readonly ParcelId[];
};

export type ExistingBuildingsOptions = {
  mode: 'parcel' | 'piece';
  setState(id: string, state: ExistingBuildingState): void;
  clearState(id: string, key: keyof ExistingBuildingState): void;
  onReplacementChange(change: ReplacementChange): void;
};

/** Bridges parcel edits to promoted tile ids without coupling replacement to roof availability. */
export class ExistingBuildings {
  private readonly hiddenParcels = new Set<ParcelId>();
  private readonly readyPieces = new Set<string>();
  private readonly parcelsByPiece = new Map<string, ParcelId | null>();
  private readonly piecesByParcel = new Map<ParcelId, Set<string>>();
  private readonly changed = new Set<ParcelId>();
  private transactionDepth = 0;
  private destroyed = false;

  constructor(private readonly options: ExistingBuildingsOptions) {}

  get hidden(): ReadonlySet<ParcelId> {
    return this.hiddenParcels;
  }

  get roofReady(): ReadonlySet<string> {
    return this.readyPieces;
  }

  /** Nested batches share one change set; completed mutations are reported even if fn throws. */
  transaction(fn: () => void): void {
    if (this.destroyed) return;
    this.transactionDepth++;
    try {
      fn();
    } finally {
      this.transactionDepth--;
      this.notifyReplacementChange();
    }
  }

  observePieces(pieces: { pieceId: string; parcelId: ParcelId | null }[]): void {
    if (this.destroyed || this.options.mode !== 'piece') return;
    for (const { pieceId, parcelId } of pieces) {
      if (this.parcelsByPiece.has(pieceId)) continue;
      this.parcelsByPiece.set(pieceId, parcelId);
      if (parcelId !== null) {
        let siblings = this.piecesByParcel.get(parcelId);
        if (!siblings) {
          siblings = new Set();
          this.piecesByParcel.set(parcelId, siblings);
        }
        siblings.add(pieceId);
        if (this.hiddenParcels.has(parcelId)) {
          this.options.setState(pieceId, { replaced: true });
        }
      }
      if (this.readyPieces.has(pieceId)) this.options.setState(pieceId, { roofReady: true });
    }
  }

  setReplaced(id: ParcelId): void {
    if (this.destroyed || this.hiddenParcels.has(id)) return;
    this.hiddenParcels.add(id);
    this.changed.add(id);
    for (const featureId of this.featureIds(id)) {
      this.options.setState(featureId, { replaced: true });
    }
    this.notifyReplacementChange();
  }

  clearReplaced(id: ParcelId): void {
    if (this.destroyed || !this.hiddenParcels.delete(id)) return;
    this.changed.add(id);
    for (const featureId of this.featureIds(id)) this.options.clearState(featureId, 'replaced');
    this.notifyReplacementChange();
  }

  clearAllReplaced(): void {
    this.transaction(() => {
      for (const id of this.hiddenParcels) this.clearReplaced(id);
    });
  }

  setRoofReady(ids: readonly string[], ready: boolean): void {
    if (this.destroyed) return;
    for (const id of ids) {
      if (ready === this.readyPieces.has(id)) continue;
      if (ready) this.readyPieces.add(id);
      else this.readyPieces.delete(id);
      // Legacy ids identify whole parcels; applying piece state there could erase fallback solids.
      if (this.options.mode !== 'piece') continue;
      if (ready) this.options.setState(id, { roofReady: true });
      else this.options.clearState(id, 'roofReady');
    }
  }

  /** Reapply both mirrors after a source removal/re-add; observation deduplication stays intact. */
  replay(): void {
    if (this.destroyed) return;
    for (const id of this.hiddenParcels) {
      for (const featureId of this.featureIds(id)) {
        this.options.setState(featureId, { replaced: true });
      }
    }
    if (this.options.mode === 'piece') {
      for (const id of this.readyPieces) this.options.setState(id, { roofReady: true });
    }
  }

  /** The map owns its feature-state lifecycle; unmount releases this adapter's retained identities. */
  destroy(): void {
    this.destroyed = true;
    this.hiddenParcels.clear();
    this.readyPieces.clear();
    this.parcelsByPiece.clear();
    this.piecesByParcel.clear();
    this.changed.clear();
  }

  private featureIds(id: ParcelId): Iterable<string> {
    return this.options.mode === 'parcel' ? [id] : (this.piecesByParcel.get(id) ?? []);
  }

  private notifyReplacementChange(): void {
    if (this.destroyed || this.transactionDepth !== 0 || this.changed.size === 0) return;
    const changed = [...this.changed];
    this.changed.clear();
    this.options.onReplacementChange({ hidden: this.hiddenParcels, changed });
  }
}
