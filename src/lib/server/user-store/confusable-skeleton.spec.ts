import { describe, it, expect } from 'vitest';
import { skeleton } from './confusable-skeleton';

describe('skeleton', () => {
  it('folds a Greek-omicron lookalike onto its Latin twin', () => {
    expect(skeleton('bοbby')).toBe(skeleton('bobby')); // bοbby == bobby
  });

  it('folds astral-plane (Mathematical Bold) sources', () => {
    // 𝐛𝐨𝐛 → bob
    expect(skeleton('\u{1D41B}\u{1D428}\u{1D41B}')).toBe(skeleton('bob'));
  });

  it('folds digit/letter lookalikes (0/o, 1/l) consistently', () => {
    expect(skeleton('b0b')).toBe(skeleton('bob'));
    expect(skeleton('bob1')).toBe(skeleton('bobl'));
  });

  it('is idempotent', () => {
    const once = skeleton('café-сat'); // mixed just for folding, not validation
    expect(skeleton(once)).toBe(once);
  });

  it('leaves a plain ASCII handle unchanged', () => {
    expect(skeleton('quiet-otter')).toBe('quiet-otter');
  });
});
