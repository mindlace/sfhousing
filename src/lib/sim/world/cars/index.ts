// The car system's public surface: the hook `withFunding(f, cars)` takes, its columns on the world
// and the snapshot a step reports; `carSystemOf` builds it for a loaded dataset.
export { createCarSystem, type CarSystemOptions } from './system';
export { carSystemOf, type CarSystemOfOptions } from './dataset';
export { carColumnsOf, carSnapshotOf, type CarColumns, type CarSnapshot } from './columns';
export {
  SPACES_STEP,
  lotShift,
  parkingTimeline,
  parkingTypeOf,
  type ParkingCosts,
  type ParkingType
} from './parking';
