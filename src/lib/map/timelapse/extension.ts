// TimelapseExtension (spec §4.2): decides each timeline part's state at `clock.day` on the GPU.
// One instance serves every timeline layer and both passes; each layer's `timelapsePass` prop
// picks the pass. `equals` compares options one level deep (layer-extension.ts), so the shared
// clock object, mutated in place by `setTime`, never re-initialises a layer.
// Shader errors do NOT reach deck's `onError` (luma 9.4.2). After link polling, a link failure
// goes asynchronously to `device.reportError` → `deviceProps.onError`
// (@luma.gl/webgl/src/adapter/resources/webgl-shared-render-pipeline.ts:79-115,
// @luma.gl/core/src/adapter/device.ts:698-711), else only to `log.error`. A compile error
// found there is thrown inside that async function (webgl-shared-render-pipeline.ts:89, :101)
// and becomes an unhandled rejection. Ruling R10: Task 11 wires the overlay's
// `deviceProps.onError`. Nothing here catches errors.
import { LayerExtension, type Accessor, type Layer, type LayerContext } from '@deck.gl/core';
import { TIMELAPSE_INJECT, timelapseModule, type TimelapseModuleProps } from './shader';
import { DYING_FADE_DAYS, DYING_HOLD_DAYS, GHOST_ALPHA } from './constants';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import { FTF_M } from '$lib/generator/constants';

export interface TimelapseExtensionProps<DataT = unknown> {
  /** Per part: partFrom, partTo, ghostFrom, endDay (§4.2.1). */
  getTlA?: Accessor<DataT, number[]>;
  /** Per part: permitDay, readyDay, constructionDay, completeDay. */
  getTlB?: Accessor<DataT, number[]>;
  /** Per part: endKind, constructionTypicalDays, stories, groundFtfM. */
  getTlC?: Accessor<DataT, number[]>;
  /** 0 solid, 1 ghost (§4.3). */
  timelapsePass?: 0 | 1;
}

const defaultProps = {
  // All-zero attributes give partTo = 0, so a part without accessors is hidden (rule 1).
  getTlA: { type: 'accessor', value: [0, 0, 0, 0] },
  getTlB: { type: 'accessor', value: [0, 0, 0, 0] },
  getTlC: { type: 'accessor', value: [0, 0, 0, 0] },
  timelapsePass: 0
};

type Rgb = [number, number, number];
const rgb01 = (name: TokenName, theme: Theme): Rgb =>
  hexToRgba(TOKENS[theme][name])
    .slice(0, 3)
    .map((v) => v / 255) as Rgb;

/** Per-theme uniform tints (0–1 RGB of the §4.6 tokens), built once at module load. */
const TINTS: Record<
  Theme,
  Pick<TimelapseModuleProps, 'tintPlanning' | 'tintPermit' | 'tintReady' | 'tintDying'>
> = {
  light: tints('light'),
  dark: tints('dark')
};
function tints(theme: Theme) {
  return {
    tintPlanning: rgb01('tl-ghost-planning', theme),
    tintPermit: rgb01('tl-ghost-permit', theme),
    tintReady: rgb01('tl-ghost-ready', theme),
    tintDying: rgb01('tl-ghost-dying', theme)
  };
}

type TimelapseLayer = Layer<Required<TimelapseExtensionProps>>;

export class TimelapseExtension extends LayerExtension<{ clock: TimelineClock }> {
  static defaultProps = defaultProps;
  static extensionName = 'TimelapseExtension';

  constructor(opts: { clock: TimelineClock }) {
    super(opts);
  }

  getShaders(this: TimelapseLayer, _extension: this) {
    return { modules: [timelapseModule], inject: TIMELAPSE_INJECT };
  }

  // As DataFilterExtension adds its attributes (data-filter-extension.ts:166-173): per-object
  // accessors on `stepMode: 'dynamic'` attributes, expanded per vertex by the layer.
  initializeState(this: TimelapseLayer, _context: LayerContext, _extension: this) {
    this.getAttributeManager()?.add({
      tlA: { size: 4, type: 'float32', stepMode: 'dynamic', accessor: 'getTlA' },
      tlB: { size: 4, type: 'float32', stepMode: 'dynamic', accessor: 'getTlB' },
      tlC: { size: 4, type: 'float32', stepMode: 'dynamic', accessor: 'getTlC' }
    });
  }

  // Runs before the layer's own draw on every render, picking included (layer.ts).
  draw(this: TimelapseLayer, _params: unknown, extension: this) {
    const { clock } = extension.opts;
    const timelapse: TimelapseModuleProps = {
      day: clock.day,
      pass: this.props.timelapsePass,
      ghostAlpha: GHOST_ALPHA[clock.theme],
      dyingHoldDays: DYING_HOLD_DAYS,
      dyingFadeDays: DYING_FADE_DAYS,
      ftfM: FTF_M,
      ...TINTS[clock.theme]
    };
    this.setShaderModuleProps({ timelapse });
  }
}
