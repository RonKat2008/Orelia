export function greet(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('name must not be empty');
  return `Welcome to Wayfinder, ${trimmed}!`;
}
