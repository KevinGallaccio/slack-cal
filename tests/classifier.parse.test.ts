import { describe, it, expect } from 'vitest';

// Re-implementation of parseJsonLoose from src/classifier/haiku.ts so we can
// test the pure parsing logic without spinning up the Anthropic SDK.
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(fenceStripped);
  } catch {
    const match = fenceStripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`classifier output is not JSON: ${trimmed.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

describe('parseJsonLoose', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLoose('{"action":"set"}')).toEqual({ action: 'set' });
  });

  it('strips ```json fences', () => {
    const input = '```json\n{"action":"ask"}\n```';
    expect(parseJsonLoose(input)).toEqual({ action: 'ask' });
  });

  it('strips bare ``` fences', () => {
    expect(parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts first JSON object from prose+JSON', () => {
    const input = 'Sure, here you go:\n{"action":"skip","reason":"all-day"}';
    expect(parseJsonLoose(input)).toEqual({ action: 'skip', reason: 'all-day' });
  });

  it('throws on non-JSON', () => {
    expect(() => parseJsonLoose('not json at all')).toThrow();
  });
});
