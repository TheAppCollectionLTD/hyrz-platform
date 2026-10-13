const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePay } = require('../src/pricing');
test('fee is £2/hour for rate up to £20',()=>{
 const r=calculatePay({hourlyPay:15,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T17:00:00Z',breakMinutes:60});
 assert.equal(r.durationHours,7);assert.equal(r.grossPay,105);assert.equal(r.platformFee,14);assert.equal(r.employerTotal,119);
});
test('fee is 10% per hour above £20',()=>{
 const r=calculatePay({hourlyPay:30,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T11:00:00Z'});
 assert.equal(r.grossPay,60);assert.equal(r.platformFee,6);
});
test('rejects invalid durations',()=>assert.throws(()=>calculatePay({hourlyPay:12,startsAt:'2026-10-10T10:00:00Z',endsAt:'2026-10-10T09:00:00Z'})));
