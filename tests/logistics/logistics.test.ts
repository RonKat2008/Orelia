import { describe, expect, it } from 'vitest';
import { distance, inState, virtualVisitLicensureFlag } from '../../lib/logistics';
describe('logistics', () => {
  it('compares normalized states without guessing missing or invalid states', () => {
    expect(inState({homeState:' ca '}, {state:'CA'}).status).toBe('yes');
    expect(inState({homeState:'CA'}, {state:'NY'}).status).toBe('no');
    for (const homeState of [undefined, '', 'ZZ', 'California']) expect(inState({homeState}, {state:'CA'}).status).toBe('unknown');
  });
  it('flags licensure for verification without asserting legal eligibility', () => {
    expect(virtualVisitLicensureFlag('CA',['ca']).status).toBe('listed');
    expect(virtualVisitLicensureFlag('CA',['NY']).status).toBe('needs_verification');
    expect(virtualVisitLicensureFlag('CA',[]).status).toBe('unknown');
    expect(virtualVisitLicensureFlag('CA',['ZZ']).status).toBe('unknown');
    expect(virtualVisitLicensureFlag(undefined,['CA']).status).toBe('unknown');
    expect(virtualVisitLicensureFlag('CA',['CA']).note).toContain("patient's state");
    expect(distance()).toEqual({status:'unknown'});
  });
});
