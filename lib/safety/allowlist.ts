/** No inferred country code: phone numbers must explicitly include their country prefix. */
export function normalizeAddress(address: string): string | null {
  const value = address.trim();
  if (/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value)) return value.toLowerCase();
  if (!/^\+[\d\s().-]+$/.test(value)) return null;
  const phone = value.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export function parseAllowlist(env: string): string[] {
  return [...new Set(env.split(',').map(normalizeAddress).filter((v): v is string => v !== null))];
}
export function isAllowed(address: string, list: readonly string[]): boolean {
  const normalized = normalizeAddress(address);
  return normalized !== null && list.some(entry => normalizeAddress(entry) === normalized);
}
