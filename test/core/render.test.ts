import { describe, expect, it } from 'vitest';
import { SNIPPET_LENGTH, snippet, sortKeys } from '../../src/core/render.js';

// About 370 characters of filler first, so the fact sits past the cut.
const filler = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
const body = `${filler} Keys start with kst_live_ here. ${filler}`;

describe('snippet', () => {
  it('leaves a short body whole', () => {
    expect(snippet('Short body.', ['live'])).toBe('Short body.');
  });

  it('cuts at the length when no search word is hidden', () => {
    expect(snippet(body)).toBe(`${body.slice(0, SNIPPET_LENGTH)}…`);
    expect(snippet(body, ['word3'])).toBe(`${body.slice(0, SNIPPET_LENGTH)}…`);
  });

  it('counts a word in the title or summary as shown', () => {
    expect(snippet(body, ['live'], 'Live keys')).toBe(`${body.slice(0, SNIPPET_LENGTH)}…`);
  });

  it('shows the intro and the text around a hidden word, at whole words', () => {
    const out = snippet(body, ['live']);
    expect(out).toContain('Keys start with kst_live_ here.');
    expect(out).toMatch(/^word0 .* word\d+ … word\d+ .* word\d+ … \(\+\d+ chars\)$/);
    expect(out.replace(/ \(\+\d+ chars\)$/, '').length).toBeLessThanOrEqual(SNIPPET_LENGTH + 6);
  });

  it('counts the characters left out', () => {
    const out = snippet(body, ['live']);
    const [intro, rest] = out.split(' … ');
    const left = Number(/\(\+(\d+) chars\)$/.exec(out)![1]);
    const window = rest!.replace(/( …)? \(\+\d+ chars\)$/, '');
    expect(left).toBe(body.length - intro!.length - window.length);
  });

  it('matches at word starts, any case, with _ as a break', () => {
    expect(snippet(body, ['LIVE'])).toContain('kst_live_');
    expect(snippet(body, ['ive'])).toBe(`${body.slice(0, SNIPPET_LENGTH)}…`);
  });

  it('keeps a match inside a long identifier', () => {
    const long = 'intro '.repeat(65) + 'key_' + 'segment_'.repeat(12) + 'live_value trailing text.';
    expect(snippet(long, ['live'])).toContain('live_value');
  });

  it('keeps a match inside a long URL', () => {
    const url = `${filler} See https://example.com/${'a'.repeat(120)}/live/docs for more. ${filler}`;
    expect(snippet(url, ['live'])).toContain('/live/docs');
  });

  it('finds a stemmed match the search index would find', () => {
    const stemmed = `${filler} Each permission is cached for five minutes. ${filler}`;
    expect(snippet(stemmed, ['permissions'])).toContain('permission is cached');
  });

  it('ends without a trailing … when the window reaches the end', () => {
    const out = snippet(`${filler} The end says kst_live_.`, ['live']);
    expect(out).toMatch(/kst_live_\. \(\+\d+ chars\)$/);
  });
});

describe('sortKeys', () => {
  it('sorts object keys at every depth and keeps arrays in order', () => {
    expect(JSON.stringify(sortKeys({ zz: 1, b: { y: 1, x: 2 }, a: 3 }))).toBe('{"a":3,"b":{"x":2,"y":1},"zz":1}');
    expect(JSON.stringify(sortKeys({ l: [{ b: 1, a: 2 }, 3] }))).toBe('{"l":[{"a":2,"b":1},3]}');
  });
});
