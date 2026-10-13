import { getRandomValues } from 'node:crypto';

// Crockford base32, as the ULID spec uses.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26-character, time-sortable, random id (https://github.com/ulid/spec). */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 256 is a multiple of 32, so `% 32` stays uniform.
  const bytes = getRandomValues(new Uint8Array(16));
  let random = '';
  for (const b of bytes) random += ENCODING[b % 32];
  return time + random;
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
