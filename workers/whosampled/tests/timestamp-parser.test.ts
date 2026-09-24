import { describe, expect, it } from 'vitest';
import { parseDataTimings, parseTimestamps } from '../src/timestamp-parser.js';

describe('timestamp text', () => {
  it.each([
    ['Sample appears at 0:06', [6000]],
    ['Sample appears at 0:06, 0:08, 0:13, 0:17 and 1:10', [6000, 8000, 13000, 17000, 70000]],
    ['Sample appears at 1:03:24', [3804000]],
    ['0:00, 00:00 and 1:10', [0, 70000]],
    ['70:02', [4202000]],
    ['0:01.125, 1:03:24.5', [1125, 3804500]],
    ['  Sample\n appears at\u00a01:10, 0:06, and 0:06. ', [6000, 70000]],
    ['0:06 & 0:08; 0:10', [6000, 8000, 10000]],
  ])('parses %s into milliseconds', (text, timestampsMs) => {
    expect(parseTimestamps(text)).toEqual({ rawText: text, timestampsMs, throughout: false });
  });

  it('retains throughout without inventing zero', () => {
    expect(parseTimestamps('Sample appears throughout')).toEqual({
      rawText: 'Sample appears throughout', timestampsMs: [], throughout: true,
    });
  });

  it('supports a starting time plus throughout, as found in historical HTML', () => {
    expect(parseTimestamps('Sample appears at 0:31 (and throughout)')).toMatchObject({
      timestampsMs: [31000], throughout: true,
    });
  });

  it.each(['', '  \n '])('reports missing text %j', (text) => {
    expect(() => parseTimestamps(text)).toThrow(expect.objectContaining({ code: 'TIMESTAMP_NOT_FOUND' }));
  });

  it.each([
    '0:60', '1:60:00', '1:00:60', '-0:06', '0:6', '0:06, broken',
    '0:06,', ',0:06', '0:06-0:10', '1:02:03:04', '0:06 or 0:08',
    'Sample appears at unknown', '0:00.1234', '99999999:00', 'around 0:06',
    'throughout 0:06', 'Sample appears at 0:06 and 99',
  ])('rejects %j instead of silently dropping data', (text) => {
    expect(() => parseTimestamps(text)).toThrow(expect.objectContaining({ code: 'TIMESTAMP_PARSE_FAILED' }));
  });

  it('converts data-timings seconds and deduplicates positions', () => {
    expect(parseDataTimings('70,6,6,0,1.125')).toEqual([0, 1125, 6000, 70000]);
    expect(parseDataTimings('')).toEqual([]);
  });

  it.each(['6,garbage', '-1', '6,', '0:06', 'NaN', '1e3', '1.1234', '2147484'])('rejects bad data-timings %s', (text) => {
    expect(() => parseDataTimings(text)).toThrow(expect.objectContaining({ code: 'TIMESTAMP_PARSE_FAILED' }));
  });
});
