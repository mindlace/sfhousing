// The car-ownership model's public surface. Pure; relative imports only.
export { CAR_LEVELS, CAR_P, IN_MIX_DRAW, MAX_TYPES, MIXES, typeCount, typeIndex } from './types';
export type { CarModel, Mix, TypeBands } from './types';
export { carShares, densityOf, meanCars } from './choice';
export type { ZoneTerms } from './choice';
export { roundSystematic, splitSystematic } from './split';
