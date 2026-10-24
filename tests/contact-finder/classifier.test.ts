import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyIntakeDoors, isRoleEmail, type IntakeDoorKind } from '../../lib/contact-finder';
import type { ExaPage } from '../../lib/sources/exa';
const url = 'https://example.org/intake';
describe('intake doors', () => {
  it.each<[IntakeDoorKind,string]>([
    ['new_patient_line','New patient line: intake@example.org'],
    ['referral_coordinator','Referral coordinator: referrals@example.org'],
    ['second_opinion_program','Our second-opinion program'],
    ['pathology_consult','Pathology consultation service'],
    ['nurse_navigator','Ask a nurse navigator'],
    ['trial_contact','Study coordinator: trials@example.org'],
    ['org_contact','Contact us: info@example.org'],
  ])('classifies %s with source evidence', (kind,text) => {
    expect(classifyIntakeDoors({url,text})).toContainEqual(expect.objectContaining({kind,evidenceUrl:url}));
  });
  it.each(['jane.doe@example.org','jdoe@example.org','drsmith@example.org','jane@example.org','referrals.jane@example.org','intake+smith@example.org','doctor@hospital.org'])('rejects personal or unrecognized email %s', email => {
    expect(isRoleEmail(email)).toBe(false);
    const result = classifyIntakeDoors({url,text:`New patient line: Dr. Jane Doe ${email}`});
    expect(result[0].emails).toEqual([]);
    expect(result[0].excerpt).not.toContain(email);
  });
  it('isolates staff addresses and keeps explicitly role-based mailboxes', () => {
    const result = classifyIntakeDoors({url,text:'New patient line: intake@example.org and jane.doe@example.org\nStaff: office@example.org'});
    expect(result[0].emails).toEqual(['intake@example.org']);
  });
  it('rejects invalid URLs, unfetched snippets and unsupported page text', () => {
    expect(classifyIntakeDoors({url:'javascript:alert(1)',text:'Contact us'})).toEqual([]);
    expect(classifyIntakeDoors({url,title:'New patient line'})).toEqual([]);
    expect(classifyIntakeDoors({url,text:'Research publications and staff biographies'})).toEqual([]);
  });
  it('classifies recorded Exa pages while preserving only returned URLs and role emails', () => {
    const root = join(process.cwd(),'fixtures/api/exa');
    let pages = 0, doors = 0;
    for (const disease of readdirSync(root,{withFileTypes:true}).filter(d => d.isDirectory())) {
      for (const file of readdirSync(join(root,disease.name)).filter(f => f.endsWith('.json'))) {
        const data = JSON.parse(readFileSync(join(root,disease.name,file),'utf8')) as {results:ExaPage[]};
        for (const page of data.results) {
          pages++;
          for (const door of classifyIntakeDoors(page)) {
            doors++;
            expect(door.evidenceUrl).toBe(page.url);
            expect(page.text?.toLowerCase()).toContain(door.excerpt.toLowerCase());
            expect(door.emails.every(isRoleEmail)).toBe(true);
          }
        }
      }
    }
    expect(pages).toBeGreaterThan(0);
    expect(doors).toBeGreaterThan(0);
  });
});

describe('contact page role mailbox', () => {
  it('takes a role email anywhere on a page that is itself the contact page, but not a personal one', () => {
    const doors = classifyIntakeDoors({ url: 'https://www.org.example/contact', title: 'Contact Us | Org', text: '# Contact Us\n\nWe read every message.\n\nWestwood, MA · team@org.example\n\nPress: jane.doe@org.example' });
    expect(doors.find(d => d.kind === 'org_contact')?.emails).toEqual(['team@org.example']);
    expect(classifyIntakeDoors({ url: 'https://www.org.example/about', title: 'About', text: 'About us\n\nteam@org.example' }).flatMap(d => d.emails)).toEqual([]);
  });
});
