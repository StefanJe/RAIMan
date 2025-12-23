export interface Rng {
  nextUint32(): number;
  nextFloat(): number; // [0,1)
  nextInt(minInclusive: number, maxExclusive: number): number;
}

// xmur3: string -> 32-bit seed
export function stringToSeed32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// mulberry32: 32-bit seed -> PRNG
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seedString: string): Rng {
  const seed = stringToSeed32(seedString);
  const next = mulberry32(seed);

  return {
    nextUint32(): number {
      return Math.floor(next() * 0x1_0000_0000) >>> 0;
    },
    nextFloat(): number {
      return next();
    },
    nextInt(minInclusive: number, maxExclusive: number): number {
      const min = Math.ceil(minInclusive);
      const max = Math.floor(maxExclusive);
      if (max <= min) return min;
      return min + Math.floor(next() * (max - min));
    }
  };
}

