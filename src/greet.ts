// Intentionally does NOT satisfy the acceptance criterion:
//   greet("world") should return "Hello, world!"
// It returns the wrong string, so a spec-derived L2 test is red-before. The
// factory's generator has to fix this for the run to go green.
export const greet = (name: string): string => `hi ${name}`
