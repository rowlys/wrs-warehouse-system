/** FR-22: `RCV-{YYYY}-{NNNNNN}` from the creation year and the global sequence value. */
export function formatDocumentNumber(year: number, sequence: bigint): string {
  return `RCV-${year}-${sequence.toString().padStart(6, '0')}`;
}
