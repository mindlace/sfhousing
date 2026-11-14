// The public surface of the step engine's core (spec S1, S2, S3, S7, S8, S11, S12).
import { withFunding } from './world';

export { monthFirstDay, monthLastDay, monthOfDay } from './months';
export { staticsOf, type Statics } from './statics';
export { DueList } from './due';
export { withFunding };
export { masterAt, scheduleAt } from './read';
export { rowStaticsOf, type RowStatic, type RowStatics, type PhaseStatic } from './pipeline';
export type {
  Due,
  FundedStart,
  FundingSystem,
  LineColumns,
  LotColumns,
  PoolColumns,
  ProjectColumns,
  StepCtx,
  StepSink,
  World,
  WorldEvent
} from './types';

const core = withFunding(null);
/** The unfunded world: `withFunding(null)`'s (S12). */
export const createWorld = core.createWorld;
export const step = core.step;
export const planDue = core.planDue;
