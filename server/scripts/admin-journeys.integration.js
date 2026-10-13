const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { hashIdentifier } = require('../src/identifier-hash');

const base = process.env.TEST_API_URL || 'http://127.0.0.1:4000/api';
const db = mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,timezone:'Z',dateStrings:true});
const checks=[];
async function check(name, fn) {
  try { await fn(); checks.push({name,ok:true}); console.log('PASS '+name); }
  catch (error) { checks.push({name,ok:false,error:error.message}); console.error('FAIL '+name+': '+error.message); }
}
async function api(path, {token,method='GET',body}={}) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data};
}
async function addUser({email,role='worker',tier=null,username=null,ni=null,permit=null,company=null}) {
  const hash=await bcrypt.hash('Test-Only-Password-2026!',4);
  const [r]=await db.execute("INSERT INTO users(email,password_hash,role,admin_tier,status,email_verified_at,first_name,last_name) VALUES(?,?,?,?,'active',UTC_TIMESTAMP(),'Test','Account')",[email,hash,role,tier]);
  if(username) await db.execute('INSERT INTO admin_login_names(user_id,username) VALUES(?,?)',[r.insertId,username]);
  if(role==='worker') {
    await db.execute('INSERT INTO worker_profiles(user_id,national_insurance_hash,worker_permit_hash,identity_verification_status,right_to_work_status) VALUES(?,?,?,?,?)',[r.insertId,ni?hashIdentifier(ni):null,permit?hashIdentifier(permit):null,'verified','verified']);
  }
  if(role==='employer') {
    await db.execute("INSERT INTO businesses(owner_user_id,name,company_number,role_at_company,verification_status,identity_verification_status) VALUES(?,?,?,'Owner','verified','verified')",[r.insertId,'Test Business',company||null]);
  }
  return r.insertId;
}
async function login(identifier) {
  const r=await api('/auth/login',{method:'POST',body:{email:identifier,password:'Test-Only-Password-2026!'}});
  assert.equal(r.status,200,JSON.stringify(r.data));return r.data.token;
}
async function main() {
  const ownerEmail=process.env.OWNER_EMAIL;
  assert.ok(ownerEmail,'OWNER_EMAIL must be set for integration tests');
  const ownerToken=await login('SimsonH');
  let tier2Id,tier3Id,workerId,employerId,checkoutId,disputeId;
  await check('Tier 1 creates Tier 2 administrator',async()=>{
    const r=await api('/admin/admins',{token:ownerToken,method:'POST',body:{email:'tier2@test.hyrz.invalid',username:'testTier2',password:'Test-Only-Password-2026!',tier:2}});
    assert.equal(r.status,201,JSON.stringify(r.data));tier2Id=r.data.id;
  });
  await check('Tier 1 creates Tier 3 administrator',async()=>{
    const r=await api('/admin/admins',{token:ownerToken,method:'POST',body:{email:'tier3@test.hyrz.invalid',username:'testTier3',password:'Test-Only-Password-2026!',tier:3}});
    assert.equal(r.status,201,JSON.stringify(r.data));tier3Id=r.data.id;
  });
  await check('Administrator account-name login works',async()=>{const r=await api('/auth/login',{method:'POST',body:{email:'testTier3',password:'Test-Only-Password-2026!'}});assert.equal(r.status,200);});
  const tier2Token=await login('testTier2'), tier3Token=await login('testTier3');
  await check('Tier 2 cannot create Tier 2 administrator',async()=>{const r=await api('/admin/admins',{token:tier2Token,method:'POST',body:{email:'forbidden@test.hyrz.invalid',username:'forbiddenTier2',password:'Test-Only-Password-2026!',tier:2}});assert.equal(r.status,403);});
  await check('Tier 3 cannot block users',async()=>{
    workerId=await addUser({email:'worker@test.hyrz.invalid',ni:'QQ123456C'});
    const r=await api('/admin/users/'+workerId+'/status',{token:tier3Token,method:'PATCH',body:{status:'blocked'}});
    assert.equal(r.status,403);
  });
  await check('Tier 1 can change administrator tiers but not its own tier',async()=>{
    const changed=await api('/admin/admins/'+tier3Id+'/tier',{token:ownerToken,method:'PATCH',body:{tier:2}});
    assert.equal(changed.status,200,JSON.stringify(changed.data));
    const self=await api('/admin/admins/'+(await api('/auth/me',{token:ownerToken})).data.user.id+'/tier',{token:ownerToken,method:'PATCH',body:{tier:2}});
    assert.equal(self.status,400);
    const restored=await api('/admin/admins/'+tier3Id+'/tier',{token:ownerToken,method:'PATCH',body:{tier:3}});
    assert.equal(restored.status,200);
  });
  await check('Tier 2 can create Tier 3 administrators',async()=>{
    const r=await api('/admin/admins',{token:tier2Token,method:'POST',body:{email:'tier3b@test.hyrz.invalid',username:'testTier3b',password:'Test-Only-Password-2026!',tier:3}});
    assert.equal(r.status,201,JSON.stringify(r.data));
  });
  await check('Tier 2 can review verification while Tier 3 cannot',async()=>{
    const r=await api('/admin/verification/worker/'+workerId,{token:tier2Token,method:'PATCH',body:{check:'identity',status:'manual_review',reason:'Integration verification review.'}});
    assert.equal(r.status,200,JSON.stringify(r.data));
    const denied=await api('/admin/verification/worker/'+workerId,{token:tier3Token,method:'PATCH',body:{check:'identity',status:'verified',reason:'Should be forbidden.'}});
    assert.equal(denied.status,403);
    await api('/admin/verification/worker/'+workerId,{token:tier2Token,method:'PATCH',body:{check:'identity',status:'verified',reason:'Restore verified state for the test.'}});
  });
  await check('Tier 2 can request client/worker deletion but cannot delete administrators',async()=>{
    const deleteWorkerId=await addUser({email:'delete-worker@test.hyrz.invalid',ni:'QQ654321D'});
    const deleted=await api('/admin/users/'+deleteWorkerId,{token:tier2Token,method:'DELETE'});
    assert.equal(deleted.status,200,JSON.stringify(deleted.data));
    const [statusRows]=await db.execute('SELECT status FROM users WHERE id=?',[deleteWorkerId]);
    assert.equal(statusRows[0].status,'pending_deletion');
    const adminDelete=await api('/admin/admins/'+tier3Id,{token:tier2Token,method:'DELETE'});
    assert.equal(adminDelete.status,403);
  });
  await check('Tier 1 financial reports are restricted to Tier 1',async()=>{
    assert.equal((await api('/admin/financial-reports',{token:ownerToken})).status,200);
    assert.equal((await api('/admin/financial-reports',{token:tier2Token})).status,403);
  });
  await check('Worker support message appears in categorized admin inbox',async()=>{
    const workerToken=await login('worker@test.hyrz.invalid');
    const sent=await api('/messages',{token:workerToken,method:'POST',body:{category:'complaints',subject:'Integration test complaint',body:'Testing support inbox delivery.'}});
    assert.equal(sent.status,201,JSON.stringify(sent.data));
    const inbox=await api('/admin/inbox',{token:ownerToken});
    assert.equal(inbox.status,200);
    assert.ok(inbox.data.messages.some(m=>Number(m.id)===Number(sent.data.id)&&m.category==='complaints'));
    const claimed=await api('/admin/messages/'+sent.data.id+'/claim',{token:ownerToken,method:'PATCH',body:{}});
    assert.equal(claimed.status,200);
    const collision=await api('/admin/messages/'+sent.data.id+'/claim',{token:tier2Token,method:'PATCH',body:{}});
    assert.equal(collision.status,409);
    const read=await api('/admin/messages/'+sent.data.id+'/read',{token:ownerToken,method:'PATCH',body:{}});
    assert.equal(read.status,200);
    const reply=await api('/admin/messages',{token:ownerToken,method:'POST',body:{recipientId:workerId,category:'complaints',subject:'Re: Integration test complaint',body:'Support has received your complaint.'}});
    assert.equal(reply.status,201,JSON.stringify(reply.data));
    const history=await api('/messages/mine',{token:workerToken});
    assert.equal(history.status,200);
    assert.ok(history.data.messages.some(m=>Number(m.id)===Number(reply.data.id)&&m.body==='Support has received your complaint.'));
  });
  await check('Blocking a worker prevents re-registration with the same identifier',async()=>{
    const blocked=await api('/admin/users/'+workerId+'/status',{token:tier2Token,method:'PATCH',body:{status:'blocked'}});
    assert.equal(blocked.status,200,JSON.stringify(blocked.data));
    const reg=await api('/auth/register',{method:'POST',body:{email:'worker-retry@test.hyrz.invalid',password:'Test-Only-Password-2026!',confirmPassword:'Test-Only-Password-2026!',role:'worker',nationalInsuranceNumber:'QQ123456C'}});
    assert.equal(reg.status,403,JSON.stringify(reg.data));
  });
  await check('Employer can submit a counter-offer and admin can accept it',async()=>{
    const activeEmployerId=await addUser({email:'counter-employer@test.hyrz.invalid',role:'employer',company:'COUNTER-EMPLOYER-55'});
    const employerToken=await login('counter-employer@test.hyrz.invalid');
    const [businessRows]=await db.execute('SELECT id FROM businesses WHERE owner_user_id=?',[activeEmployerId]);
    const [shift]=await db.execute("INSERT INTO shifts(business_id,created_by,title,location,starts_at,ends_at,hourly_pay) VALUES(?,?,'Counter test shift','London',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 26 HOUR),15)",[businessRows[0].id,activeEmployerId]);
    const [checkout]=await db.execute("INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,worker_comment,status,gross_pay,platform_fee) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 26 HOUR),0,'Worker submitted times','submitted',30,3)",[shift.insertId,workerId]);
    const offer=await api('/checkouts/'+checkout.insertId+'/counter-offer',{token:employerToken,method:'POST',body:{comment:'Employer proposes adjusted end time.',actualStart:new Date(Date.now()+86400000).toISOString().slice(0,19).replace('T',' '),actualEnd:new Date(Date.now()+26*3600000).toISOString().slice(0,19).replace('T',' '),breakMinutes:0}});
    assert.equal(offer.status,201,JSON.stringify(offer.data));
    const [disputes]=await db.execute("SELECT id FROM disputes WHERE checkout_id=? AND status='open'",[checkout.insertId]);
    assert.equal(disputes.length,1);
    const resolved=await api('/admin/disputes/'+disputes[0].id+'/resolve',{token:tier3Token,method:'PATCH',body:{outcome:'employer',resolution:'Accepted employer counter-offer.'}});
    assert.equal(resolved.status,200,JSON.stringify(resolved.data));
    const [invoices]=await db.execute('SELECT id FROM invoices WHERE checkout_id=?',[checkout.insertId]);assert.equal(invoices.length,1);
  });
  await check('Employer company block prevents repeat registration',async()=>{
    employerId=await addUser({email:'employer@test.hyrz.invalid',role:'employer',company:'TEST-COMPANY-123'});
    const blocked=await api('/admin/users/'+employerId+'/status',{token:ownerToken,method:'PATCH',body:{status:'blocked'}});
    assert.equal(blocked.status,200);
    const reg=await api('/auth/register',{method:'POST',body:{email:'employer-retry@test.hyrz.invalid',password:'Test-Only-Password-2026!',confirmPassword:'Test-Only-Password-2026!',role:'employer',businessName:'Test Business',companyRole:'Owner',companyNumber:'test-company-123'}});
    assert.equal(reg.status,403,JSON.stringify(reg.data));
  });
  await check('Invoice list and audit log endpoints return data',async()=>{
    const [businessRows]=await db.execute('SELECT id FROM businesses WHERE owner_user_id=?',[employerId]);
    const businessId=businessRows[0].id;
    const [shift]=await db.execute("INSERT INTO shifts(business_id,created_by,title,location,starts_at,ends_at,hourly_pay) VALUES(?,?,'Test shift','London',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 26 HOUR),15)",[businessId,employerId]);
    const [checkout]=await db.execute("INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,worker_comment,status,gross_pay,platform_fee) VALUES(?,?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 HOUR),0,'Test checkout','disputed',30,3)",[shift.insertId,workerId]);
    checkoutId=checkout.insertId;
    const [dispute]=await db.execute("INSERT INTO disputes(checkout_id,opened_by,reason,evidence_url) VALUES(?,?,'Integration dispute','https://example.invalid/evidence')",[checkoutId,employerId]);
    disputeId=dispute.insertId;
    assert.equal((await api('/admin/invoices',{token:ownerToken})).status,200);
    assert.equal((await api('/admin/audit-logs',{token:ownerToken})).status,200);
    const list=await api('/admin/disputes',{token:ownerToken});assert.equal(list.status,200);assert.ok(list.data.disputes.some(d=>Number(d.id)===Number(disputeId)));
  });
  await check('Admin can claim and resolve a checkout dispute, creating an invoice',async()=>{
    assert.equal((await api('/admin/disputes/'+disputeId+'/assign',{token:tier3Token,method:'PATCH',body:{}})).status,200);
    const resolved=await api('/admin/disputes/'+disputeId+'/resolve',{token:tier3Token,method:'PATCH',body:{outcome:'worker',resolution:'Integration test resolution accepted.'}});
    assert.equal(resolved.status,200,JSON.stringify(resolved.data));
    const [invoices]=await db.execute('SELECT id FROM invoices WHERE checkout_id=?',[checkoutId]);assert.equal(invoices.length,1);
    const reminder=await api('/admin/invoices/'+invoices[0].id+'/send-reminder',{token:ownerToken,method:'POST',body:{}});
    assert.equal(reminder.status,503,'Without Resend credentials the reminder should fail clearly rather than claim delivery.');
  });
  await check('Tier 1 can record and approve referral commissions',async()=>{
    const r=await api('/admin/referral-commissions',{token:ownerToken,method:'POST',body:{referrerUserId:workerId,referredUserId:employerId,amount:25}});
    assert.equal(r.status,201,JSON.stringify(r.data));
    const update=await api('/admin/referral-commissions/'+r.data.id+'/status',{token:ownerToken,method:'PATCH',body:{status:'paid'}});
    assert.equal(update.status,200,JSON.stringify(update.data));
  });
  await check('Administrator password can be changed and used to sign in',async()=>{
    const changed=await api('/admin/change-password',{token:tier3Token,method:'POST',body:{currentPassword:'Test-Only-Password-2026!',newPassword:'Changed-Only-Password-2026!'}});
    assert.equal(changed.status,200,JSON.stringify(changed.data));
    const loginChanged=await api('/auth/login',{method:'POST',body:{email:'testTier3',password:'Changed-Only-Password-2026!'}});
    assert.equal(loginChanged.status,200,JSON.stringify(loginChanged.data));
  });
  await db.end();
  if(checks.some(c=>!c.ok)){console.error(JSON.stringify(checks,null,2));process.exitCode=1;}
  else console.log('All '+checks.length+' admin integration checks passed.');
}
main().catch(async e=>{console.error(e);try{await db.end();}catch(_){}process.exitCode=1;});
