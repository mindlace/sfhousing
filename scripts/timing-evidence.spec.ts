import { describe, expect, it } from 'vitest';
import type { InFlightProject, ProjectsFile } from '../src/lib/timelapse/projects';
import { smallStreamlinedShare } from './timing-evidence';

const project = (pathway: InFlightProject['pathway'], units: number) =>
  ({ pathway, units }) as InFlightProject;

describe('smallStreamlinedShare', () => {
  it('counts streamlined projects at or under 150 units, ignoring other pathways', () => {
    const file = {
      projects: [
        project('streamlined', 150),
        project('streamlined', 151),
        project('streamlined', 10),
        project('discretionary', 5)
      ]
    } as ProjectsFile;
    expect(smallStreamlinedShare(file)).toEqual({ share: 2 / 3, small: 2, n: 3 });
  });

  it('is NaN with no streamlined project', () => {
    const r = smallStreamlinedShare({ projects: [] } as unknown as ProjectsFile);
    expect(r.n).toBe(0);
    expect(Number.isNaN(r.share)).toBe(true);
  });
});
