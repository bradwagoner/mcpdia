import { describe, expect, it } from 'vitest';
import { SNIPPET_LENGTH, snippet } from '../../src/core/render.js';

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

  it('ends without a trailing … when the window reaches the end', () => {
    const out = snippet(`${filler} The end says kst_live_.`, ['live']);
    expect(out).toMatch(/kst_live_\. \(\+\d+ chars\)$/);
  });
});
