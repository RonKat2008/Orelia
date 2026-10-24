import { expect, it } from 'vitest';
import { inNetwork, lookupInNetwork, type DirectoryResult } from '../../lib/network';
const query = {insurer:'Synthetic plan',planId:'test-plan',providerNpi:'1234567890'};
const result: DirectoryResult = {...query,status:'yes',sourceUrl:'https://example.org/directory',checkedAt:'2026-10-24T00:00:00Z'};
it('defaults to unknown and uses only matching sourced plan results', () => {
  expect(inNetwork(query).status).toBe('unknown');
  expect(inNetwork(query,result).status).toBe('yes');
  expect(inNetwork(query,{...result,status:'no'}).status).toBe('no');
  for (const change of [{planId:'other'}, {insurer:'other'}, {providerNpi:'other'}, {sourceUrl:'mailto:a@example.org'}, {checkedAt:'bad'}]) expect(inNetwork(query,{...result,...change}).status).toBe('unknown');
  expect(inNetwork({...query,planId:''},{...result,planId:''}).status).toBe('unknown');
});
it('supports injected ports and degrades failures to unknown', async () => {
  expect((await lookupInNetwork(query)).status).toBe('unknown');
  expect((await lookupInNetwork(query,{lookup:async () => result})).status).toBe('yes');
  expect((await lookupInNetwork(query,{lookup:async () => {throw Error('offline');}})).status).toBe('unknown');
});
