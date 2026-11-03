export type DockFace = 'edit' | 'results';
/** Phones: 'closed' shows the handle only; 'peek' about 40dvh; 'full' up to 85dvh. */
export type SheetSize = 'closed' | 'peek' | 'full';

/**
 * The dock's state, shared by the page and `Dock.svelte`. `open` is the desktop panel (true) or
 * rail (false); `sheet` is the phone sheet. The two are independent so a window that is resized
 * keeps both; `face` and `tab` are shared by both widths.
 */
export class DockState {
  face = $state<DockFace>('edit');
  tab = $state('');
  open = $state(true);
  sheet = $state<SheetSize>('closed');

  constructor(opts: { tab: string; open?: boolean }) {
    this.tab = opts.tab;
    this.open = opts.open ?? true;
  }

  /** Results, shown (Run, the header score): desktop opens the panel even from the rail; a phone sheet below 'peek' goes to 'peek'. */
  showResults(): void {
    this.face = 'results';
    this.open = true;
    if (this.sheet === 'closed') this.sheet = 'peek';
  }

  /** The editing face, at `tab` when given; a phone sheet at 'peek' goes to 'full'. */
  showEdit(tab?: string): void {
    this.face = 'edit';
    if (tab !== undefined) this.tab = tab;
    if (this.sheet === 'peek') this.sheet = 'full';
  }

  /** The header score in Set Policy: Results <-> editing face, opening the dock if hidden. */
  toggleResults(wide: boolean): void {
    if (!this.visible(wide) || this.face === 'edit') this.showResults();
    else this.showEdit();
  }

  /** The header's Policy / Paint button and Escape: desktop open <-> rail; phone closed <-> full. */
  toggleOpen(wide: boolean): void {
    if (wide) this.open = !this.open;
    else this.sheet = this.sheet === 'closed' ? 'full' : 'closed';
  }

  /** The dock shows its body: desktop `open`, phones `sheet !== 'closed'`. */
  visible(wide: boolean): boolean {
    return wide ? this.open : this.sheet !== 'closed';
  }

  /** The viewport crossed md: a phone sheet that was open becomes the desktop panel. */
  widthChanged(wide: boolean): void {
    if (wide && this.sheet !== 'closed') this.open = true;
  }
}
