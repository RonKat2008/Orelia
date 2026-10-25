/** "Used 2 of your documents" copy, singular-aware. Client-safe (no server imports). */
export function usedLabel(count: number): string {
  return count === 1 ? 'Used 1 of your documents' : `Used ${count} of your documents`;
}
