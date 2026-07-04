import { expect, it } from 'vitest'
import { greet } from './greet.ts'

// In-scope (src/**) test documenting the CURRENT, pre-implementation behaviour
// so the repo's own suite is green (the factory's L1 regression gate). The
// corrected behaviour is asserted by the out-of-scope, factory-authored L2 test.
it('greet returns the current (pre-implementation) string', () => {
  expect(greet('world')).toBe('hi world')
})
