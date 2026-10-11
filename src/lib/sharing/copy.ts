import { MAX_PLAN_BYTES } from '$lib/plan';
import type { ShareErrorCode } from './api';

export const kb = (bytes: number): number => Math.ceil(bytes / 1024);
export const LIMIT_KB: number = MAX_PLAN_BYTES / 1024;

export const COPY = {
  disabledHint: 'Paint something first.',
  dialogHeading: 'Publish this plan',
  dialogBody:
    'Published plans are public and permanent. Anyone with the link can view and remix it. You can keep editing your own copy afterward.',
  successHeading: 'Published',
  tooManyOps: 'This plan has more than 5,000 strokes, the most a shared plan can hold.',
  unknownDataset:
    "This plan uses map data the server doesn't recognise. Reload the page and try again.",
  rateLimited: 'Too many plans published from your network. Try again in a minute.',
  network: "Couldn't publish. Check your connection and try again.",
  notFoundHeading: 'Plan not found',
  notFoundBody: "This link doesn't match a published plan. It may have been mistyped or removed.",
  startOwn: 'Start your own plan',
  unparsable: "This plan can't be shown by this version of the app.",
  autosaveOff: 'Autosave off',
  n1: "Your saved plan couldn't be read, so we started a new one. The old data was kept in this browser in case it can be recovered.",
  n2: 'Your saved plan was made by a newer version of this app. We started a new one; the old plan was kept in this browser.',
  n4: "Your browser isn't letting this site save. Changes will be lost when you close the tab. Publish to keep a copy."
} as const;

export const sizeLine = (bytes: number): string => `Size: ${kb(bytes)} KB of ${LIMIT_KB} KB`;
export const tooLarge = (bytes: number): string =>
  `This plan is too large to share (${kb(bytes)} KB of the ${LIMIT_KB} KB limit). Try fewer or shorter strokes.`;
export const cannotRead = (code: string): string =>
  `The server couldn't read this plan (code: ${code}). Please report this.`;
export const n3 = (oldV: string, newV: string): string =>
  `Your plan was made with an older map dataset (${oldV}). It's now shown on the current data (${newV}), so some numbers may differ.`;
export const n5 = (planV: string, current: string): string =>
  `Made with map data ${planV}. Remixing moves it to the current data (${current}); numbers may change.`;
export const n6 = (planV: string, current: string): string =>
  `Made with map data ${planV}, which is no longer available. Shown on the current data (${current}); numbers may differ from when it was published.`;
export const remixedToast = (label: string): string =>
  `Remixed from ${label}. You're editing your own copy.`;
export const remixConfirm = (n: number): string =>
  `Replace your current plan (${n} strokes) with a copy of this one? Your current plan will be lost unless you publish it first.`;
export const ogDescription = (n: number): string =>
  `A plan for San Francisco housing with ${n} brush strokes. Open it to see the buildings and net new units.`;

export function serverMessage(code: ShareErrorCode, bytes?: number): string {
  switch (code) {
    case 'too_large':
      return bytes === undefined
        ? `This plan is too large to share (over the ${LIMIT_KB} KB limit). Try fewer or shorter strokes.`
        : tooLarge(bytes);
    case 'too_many_ops':
      return COPY.tooManyOps;
    case 'unknown_dataset_version':
      return COPY.unknownDataset;
    case 'rate_limited':
      return COPY.rateLimited;
    case 'not_found':
      return COPY.notFoundHeading + '.';
    case 'server_error':
      return COPY.network;
    default:
      return cannotRead(code);
  }
}

export function formatPublished(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}
