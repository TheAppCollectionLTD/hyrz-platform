process.env.COMPANIES_HOUSE_API_KEY = 'test';
const assert = require('assert');
const { checkCompany } = require('../src/verification-routes');
const profile = { company_name: 'OWENS EVENTS LIMITED', company_status: 'active', registered_office_address: { postal_code: 'SW1A 1AA' } };
const officers = { items: [{ name: 'OWENS, Omar James', officer_role: 'director' }, { name: 'SMITH, Ann', officer_role: 'secretary', resigned_on: '2020-01-01' }], total_results: 2 };
global.fetch = async url => ({ ok: true, status: 200, json: async () => (String(url).includes('/officers') ? officers : profile) });
(async () => {
  const base = { companyNumber: '12345678', businessName: 'Owens Events Ltd', firstName: 'Omar', lastName: 'Owens', postcode: 'SW1A1AA' };
  assert.equal((await checkCompany(base)).status, 'verified');
  assert.equal((await checkCompany({ ...base, businessName: 'Other Co' })).status, 'manual_review');
  assert.equal((await checkCompany({ ...base, firstName: 'Ann', lastName: 'Smith' })).status, 'manual_review');
  assert.equal((await checkCompany({ ...base, companyNumber: '' })).status, 'manual_review');
  profile.company_status = 'dissolved';
  assert.equal((await checkCompany(base)).status, 'rejected');
  global.fetch = async () => ({ ok: false, status: 404 });
  assert.equal((await checkCompany(base)).status, 'rejected');
  console.log('company check tests passed');
})().catch(e => { console.error(e); process.exit(1); });
