import { describe } from 'vitest';
import { memorySimDb } from './sim-db';
import { simDbContract } from './test/sim-db-contract';

describe('memorySimDb', () => simDbContract(async (o) => memorySimDb(o)));
