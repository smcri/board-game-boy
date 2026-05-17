/**
 * Seeded RNG using Mulberry32 algorithm.
 * Deterministic: same seed produces same sequence.
 */

/**
 * Create a seeded pseudo-random number generator.
 * @param seed - Initial seed value
 * @returns Function that returns next random number in [0, 1)
 */
export function createRNG(seed: number): () => number {
  let state = seed;
  return function mulberry32() {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to a seed number.
 */
export function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) || 1;
}
