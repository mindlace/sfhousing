// R1 (contracts stub): the run's sounds. run-play makes it real.
export interface Sound {
  pop(): void;
  collect(): void;
  goal(): void;
  buy(): void;
}

export function createSound(_muted: () => boolean): Sound {
  throw new Error('not implemented');
}
