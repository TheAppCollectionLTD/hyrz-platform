const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePay, weeklyBulkCredit } = require('../src/pricing');
test('fee is £2/hour for rate up to £20',()=>{
 const r=calculatePay({hourlyPay:15,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T17:00:00Z',breakMinutes:60});
 assert.equal(r.durationHours,7);assert.equal(r.grossPay,105);assert.equal(r.platformFee,14);assert.equal(r.employerTotal,119);
});
test('fee is £2/hour at exactly £20',()=>{
 assert.equal(calculatePay({hourlyPay:20,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T10:00:00Z'}).platformFee,2);
});
test('fee is 10p per £1 paid above £20',()=>{
 const r=calculatePay({hourlyPay:30,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T11:00:00Z'});
 assert.equal(r.grossPay,60);assert.equal(r.platformFee,6);
});
test('bulk fee is £1.50/hour up to £20',()=>{
 assert.equal(calculatePay({hourlyPay:12,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T17:00:00Z',bulk:true}).platformFee,12);
 assert.equal(calculatePay({hourlyPay:25,startsAt:'2026-10-10T09:00:00Z',endsAt:'2026-10-10T11:00:00Z',bulk:true}).platformFee,5);
});
test('weekly credit: 5 workers and 40 hours qualifies, refunds 50p/hour on rates up to £20',()=>{
 const lines=[1,2,3,4,5].map(w=>({workerId:w,hours:8,rate:12,fee:16}));
 assert.deepEqual(weeklyBulkCredit(lines),{workers:5,hours:40,qualifies:true,credit:20});
});
test('weekly credit: rates above £20 get no refund',()=>{
 const lines=[1,2,3,4].map(w=>({workerId:w,hours:8,rate:12,fee:16})).concat({workerId:5,hours:8,rate:25,fee:20});
 assert.equal(weeklyBulkCredit(lines).credit,16);
});
test('weekly credit: 4 workers or under 40 hours does not qualify',()=>{
 assert.equal(weeklyBulkCredit([1,2,3,4].map(w=>({workerId:w,hours:12,rate:12,fee:24}))).qualifies,false);
 assert.equal(weeklyBulkCredit([1,2,3,4,5].map(w=>({workerId:w,hours:7.9,rate:12,fee:15.8}))).qualifies,false);
});
test('rejects invalid durations',()=>assert.throws(()=>calculatePay({hourlyPay:12,startsAt:'2026-10-10T10:00:00Z',endsAt:'2026-10-10T09:00:00Z'})));
