import { formatDocumentNumber } from './document-number';

describe('formatDocumentNumber', () => {
  it.each([
    [2026, 1n, 'RCV-2026-000001'],
    [2026, 42n, 'RCV-2026-000042'],
    [2027, 999999n, 'RCV-2027-999999'],
  ])('FR-22 formats (%i, %s) as %s', (year, n, expected) => {
    expect(formatDocumentNumber(year, n)).toBe(expected);
  });
});
