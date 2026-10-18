// The timelapse renderer's deck.gl entry: the only module SimMap lazy-imports, so the GPU code
// (and @luma.gl/engine) loads only in FZP mode.
export { TimelapseExtension } from './extension';
export { StageBarLayer } from './stage-bar-layer';
