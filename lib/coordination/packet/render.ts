import type { PacketSection, SpecialistPacket } from '../contract';

export const PACKET_HEADER = 'Prepared by the patient with Orelia AI assistance. The patient reviewed this packet and chose each section below.';

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;
const oneLine = (s: string) => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim();

/** The sections the patient ticked and that have content. Nothing else is ever rendered, printed or attached. */
export function includedSections(packet: Pick<SpecialistPacket, 'sections'>): PacketSection[] {
  return packet.sections.filter(s => s.included && s.items.length > 0);
}

/** Plain text of the INCLUDED sections only, with the AI-assistance header. */
export function renderPacketText(packet: SpecialistPacket): string {
  const blocks = includedSections(packet).map(section => {
    const lines = section.items.map(i => `- ${i.date ? `${i.date}: ` : ''}${oneLine(i.text)}${i.sourceUrl ? ` (source: ${i.sourceUrl})` : ''}`);
    return `${section.title}\n${lines.join('\n')}`;
  });
  return [`${PACKET_HEADER}\nFor: ${oneLine(packet.name)}`, ...blocks].join('\n\n');
}
