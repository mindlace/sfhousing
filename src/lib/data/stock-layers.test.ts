import { expect, it } from 'vitest';
import { mostPermissive } from './stock-layers';

it('picks the larger hostable layer; a tie or a non-hostable b keeps a', () => {
  expect(mostPermissive({ yieldTop: 10, hostable: true }, { yieldTop: 11, hostable: true })).toBe(
    'b'
  );
  expect(mostPermissive({ yieldTop: 10, hostable: true }, { yieldTop: 10, hostable: true })).toBe(
    'a'
  );
  expect(mostPermissive({ yieldTop: 0, hostable: false }, { yieldTop: 5, hostable: true })).toBe(
    'b'
  );
  expect(mostPermissive({ yieldTop: 3, hostable: true }, { yieldTop: 99, hostable: false })).toBe(
    'a'
  );
});
