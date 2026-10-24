/** Conservative allowlist for the supported disease families. Unknown families fail closed. */
export const diseaseTaxonomies = [
  { disease: /sarcoma/i, codes: ["207RH0003X", "207RX0202X", "207RH0000X", "2086X0206X", "207X00000X", "207ZP0101X", "207ZP0102X", "207ZP0105X", "207ZP0104X", "207ZP0107X"], descriptions: [/^(hematology (&|and) oncology|medical oncology|hematology|surgical oncology|orthop(ae|e)dic surgery|anatomic pathology|anatomic pathology (&|and) clinical pathology|clinical pathology|dermatopathology|musculoskeletal oncology)$/i] },
  { disease: /vascular.*(ehlers|eds)|\bveds\b/i, codes: ["207SG0201X", "207SG0202X", "207SG0203X", "207SC0300X", "2086S0129X", "207RC0000X"], descriptions: [/^(clinical genetics \(m\.d\.\)|clinical biochemical genetics|clinical molecular genetics|clinical cytogenetics|vascular surgery|cardiovascular disease|medical genetics)$/i] },
  { disease: /igg4/i, codes: ["207RR0500X", "207RG0100X", "207ZP0101X", "207ZP0102X", "207ZP0105X", "207ZP0104X"], descriptions: [/^(rheumatology|gastroenterology|anatomic pathology|anatomic pathology (&|and) clinical pathology|clinical pathology)$/i] },
] as const;

export function relevantTaxonomy(disease: string, code?: string, description?: string): boolean {
  const rule = diseaseTaxonomies.find((r) => r.disease.test(disease));
  return !!rule && ((rule.codes as readonly string[]).includes(code ?? "") || rule.descriptions.some((r) => r.test(description?.trim() ?? "")));
}
