import { describe, expect, it } from 'vitest';
import { webFormRowsFromPage, webFormsOnPage } from '@/lib/contact-finder/web-forms';
import { parsePlanContactPoints } from '@/lib/plan/contact-points';
import { planResource } from '@/lib/plan/rules';

const AT = '2026-01-01T00:00:00.000Z';

// A program landing page: it is not itself a form (no field labels), but it links to the online application.
const markdownProgram = {
  url: 'https://www.rarefund.org/programs/medical-travel-grant',
  title: 'Patient Medical Travel Grant | Rare Fund',
  text: [
    '### Patient Medical Travel Grant',
    'The Patient Medical Travel Grant helps families who must travel to receive specialized medical care.',
    'Grants are awarded quarterly until funds are allocated.',
    '[Apply online](https://www.rarefund.org/travel-grant/apply)',
    '[Donate](https://www.rarefund.org/donate) | [Contact us](mailto:info@rarefund.org)',
  ].join('\n'),
};

const htmlProgram = {
  url: 'https://www.rarefund.org/programs/financial-aid',
  title: 'Financial Aid Funds',
  text: '<h2>Financial Aid Funds</h2><p>Small grants for patients who meet financial and medical criteria.</p>'
    + '<a class="btn btn-primary" href="/financial-aid/application">Apply now</a>'
    + '<a href="/donate">Give today</a>',
};

describe('webFormsOnPage: forms a fetched program page links to', () => {
  it('stamps the href of a markdown "Apply online" link as an application form (sourced from the program page)', () => {
    expect(webFormsOnPage(markdownProgram)).toEqual([{
      origin: 'application_form',
      url: 'https://www.rarefund.org/travel-grant/apply',
      sourceUrl: markdownProgram.url,
      sourceKind: 'exa',
    }]);
  });

  it('resolves a relative href of an HTML <a>Apply now</a> button against the page URL', () => {
    expect(webFormsOnPage(htmlProgram)).toEqual([{
      origin: 'application_form',
      url: 'https://www.rarefund.org/financial-aid/application',
      sourceUrl: htmlProgram.url,
      sourceKind: 'exa',
    }]);
  });

  it("uses the page's own link list (Exa extras.links) when the text carries no hrefs", () => {
    // Shape of the real TotalAssist page: plain text mentions applying; links come from the page's anchors.
    const page = {
      url: 'https://totalassist.org/',
      title: 'TotalAssist',
      text: 'Charitable patient financial assistance for out-of-pocket costs. Check eligibility and apply today.',
      links: ['/apply-patients/', '/apply-pharmacies/', '/apply-providers/', '/apply-nonprofits/', 'https://portal.totalassist.org'],
    };
    expect(webFormsOnPage(page).map((f) => [f.origin, f.url])).toEqual([['application_form', 'https://totalassist.org/apply-patients/']]);
  });

  it('accepts an apply portal on a subdomain of the same site (Patient Advocate Foundation shape), ignoring its login route', () => {
    const page = {
      url: 'https://www.patientadvocate.org/connect-with-services/financial-aid-funds/',
      title: 'Financial Aid Funds',
      text: 'These open funds are accepting applications. Register and apply by online here.',
      links: ['https://www.patientadvocate.org/wp-content/uploads/Program-Disclaimer-2025.pdf', 'https://financialaid.patientadvocate.org/', 'https://financialaid.patientadvocate.org/#/login', 'https://www.py4foundation.org/'],
    };
    expect(webFormsOnPage(page).map((f) => f.url)).toEqual(['https://financialaid.patientadvocate.org/']);
  });

  it('skips an ambiguous page that links many different applications (one per disease program) and file downloads', () => {
    const page = {
      url: 'https://rarediseases.org/patient-assistance-programs/',
      title: 'Patient Assistance Programs',
      text: 'If you find your condition, you can apply directly through that program using the Apply Online button.',
      links: [
        'https://applications.rarediseases.org/Home/WebEnroll?pId=262',
        'https://applications.rarediseases.org/Data/GetFile?guid=31461da74ed74a7196ba11608187bebf',
        'https://applications.rarediseases.org/Home/WebEnroll?pId=261',
      ],
    };
    expect(webFormsOnPage(page)).toEqual([]);
  });

  it('never stamps a link to another site, a document, a mailto, a donation or login page, or a bare URL in the text', () => {
    const page = {
      url: 'https://www.rarefund.org/programs/help',
      title: 'Help',
      text: [
        'Apply at https://www.rarefund.org/plain-text/apply today.',
        '[Apply now](https://www.other-charity.org/apply)',
        '[Application (PDF)](https://www.rarefund.org/files/application.pdf)',
        '[Apply by email](mailto:apply@rarefund.org)',
        '[Sign in to apply](https://www.rarefund.org/login)',
        '[Apply to volunteer](https://www.rarefund.org/volunteer/apply)',
        '![Apply](https://www.rarefund.org/img/apply.png)',
      ].join('\n'),
      links: ['https://www.other-charity.org/apply', 'javascript:apply()'],
    };
    expect(webFormsOnPage(page)).toEqual([]);
  });

  it('needs apply wording on the page before trusting a bare link list', () => {
    const page = { url: 'https://www.rarefund.org/about', title: 'About us', text: 'We support families with rare conditions.', links: ['https://www.rarefund.org/apply'] };
    expect(webFormsOnPage(page)).toEqual([]);
  });

  it('finds nothing on a program page that has no online application (real Vascular Anomalies Alliance shape)', () => {
    const page = {
      url: 'https://www.vascularally.org/travelgrant',
      title: 'Medical Travel Grant | Support Medical Travel Now — Vascular Anomalies Alliance',
      text: '### Patient Medical Travel Grant\nFind more information below on the qualifications to apply and reach out for any further questions.\n### All 2026 Travel Grant Funds have been allocated for 2026.\n Contact Us (admin@vascularally.org)',
      links: ['mailto:admin@vascularally.org?'],
    };
    expect(webFormsOnPage(page)).toEqual([]);
  });

  it('classifies linked referral and appointment-request forms', () => {
    const page = {
      url: 'https://www.northgate-health.org/rare-disease-clinic',
      title: 'Rare Disease Clinic',
      text: '[Refer a patient](https://www.northgate-health.org/refer-a-patient)\n[Request an appointment](https://www.northgate-health.org/request-appointment)',
    };
    expect(webFormsOnPage(page).map((f) => [f.origin, f.url])).toEqual([
      ['referral_form', 'https://www.northgate-health.org/refer-a-patient'],
      ['intake_form', 'https://www.northgate-health.org/request-appointment'],
    ]);
  });

  it('end to end: the stamped row parses as a web_form contact point and the aid plan applies online first', () => {
    const rows = [
      ...webFormRowsFromPage(markdownProgram, AT),
      { id: 'cp:email', claimType: 'contact_point.email.org_contact', claim: 'grants@rarefund.org', sourceUrl: markdownProgram.url, sourceKind: 'exa' as const, fetchedAt: AT },
    ];
    expect(rows[0]).toMatchObject({ claimType: 'contact_point.web_form.application_form', claim: 'https://www.rarefund.org/travel-grant/apply', sourceUrl: markdownProgram.url, sourceKind: 'exa' });
    expect(parsePlanContactPoints(rows).map((p) => p.channel)).toContain('web_form');
    const plan = planResource({ targetKind: 'organization', targetId: 'org:rarefund', name: 'Rare Fund', contactId: null, subKind: 'travel_aid', evidence: rows });
    expect(plan.steps[0]).toMatchObject({ channel: 'web_form', targetRef: 'https://www.rarefund.org/travel-grant/apply' });
  });
});
