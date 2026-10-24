const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats YYYY / YYYY-MM / YYYY-MM-DD at the precision the record gave. null -> "Date not stated". */
export function formatPartialDate(date: string | null): string {
  if (!date) return 'Date not stated';
  const [y, m, d] = date.split('-');
  const month = m ? MONTHS[Number(m) - 1] : undefined;
  if (!month) return y;
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
}
