require('dotenv').config();

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { hashIdentifier } = require('../src/identifier-hash');

const base = process.env.TEST_API_URL || 'http://127.0.0.1:4001/api';
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
  const ownerEmail=process.env.OWNER_EMAIL || 'test.owner@hyrz.local';
  const ownerToken=await login(ownerEmail);
  let tier2Id,tier3Id,tier3bId,workerId,employerId,checkoutId,disputeId;
  await check('Password reset rejects invalid or expired tokens and short passwords',async()=>{
    const invalidToken=await api('/auth/password-reset/confirm',{method:'POST',body:{token:'not-a-valid-reset-token',newPassword:'Valid-Long-Password-2026!'}});
    assert.equal(invalidToken.status,400);
    const shortPassword=await api('/auth/password-reset/confirm',{method:'POST',body:{token:'a'.repeat(64),newPassword:'short'}});
    assert.equal(shortPassword.status,400);
  });
  await check('Password reset consumes its token once and revokes old sessions',async()=>{
    const resetUserId=await addUser({email:'password-reset-worker@test.hyrz.invalid',ni:'QQ505050E'});
    const oldToken=await login('password-reset-worker@test.hyrz.invalid');
    const rawResetToken=crypto.randomBytes(32).toString('hex');
    const tokenHash=crypto.createHash('sha256').update(rawResetToken).digest('hex');
    await db.execute('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))',[resetUserId,tokenHash]);
    const reset=await api('/auth/password-reset/confirm',{method:'POST',body:{token:rawResetToken,newPassword:'Reset-Only-Password-2026!'}});
    assert.equal(reset.status,200,JSON.stringify(reset.data));
    assert.equal((await api('/auth/me',{token:oldToken})).status,401,'Password reset must revoke old sessions.');
    const reuse=await api('/auth/password-reset/confirm',{method:'POST',body:{token:rawResetToken,newPassword:'Reset-Only-Password-2026!'}});
    assert.equal(reuse.status,400,'A reset token must not be reusable.');
    const newLogin=await api('/auth/login',{method:'POST',body:{email:'password-reset-worker@test.hyrz.invalid',password:'Reset-Only-Password-2026!'}});
    assert.equal(newLogin.status,200,JSON.stringify(newLogin.data));
  });
  await check('Tier 1 creates Tier 2 administrator',async()=>{
    const r=await api('/admin/admins',{token:ownerToken,method:'POST',body:{email:'tier2@test.hyrz.invalid',password:'Test-Only-Password-2026!',tier:2}});
    assert.equal(r.status,201,JSON.stringify(r.data));tier2Id=r.data.id;
  });
  await check('Tier 1 creates Tier 3 administrator',async()=>{
    const r=await api('/admin/admins',{token:ownerToken,method:'POST',body:{email:'tier3@test.hyrz.invalid',password:'Test-Only-Password-2026!',tier:3}});
    assert.equal(r.status,201,JSON.stringify(r.data));tier3Id=r.data.id;
  });
  await check('Administrator email login works',async()=>{const r=await api('/auth/login',{method:'POST',body:{email:'tier3@test.hyrz.invalid',password:'Test-Only-Password-2026!'}});assert.equal(r.status,200);});
  await check('Administrator email cannot be reused by another account type',async()=>{const r=await api('/auth/register',{method:'POST',body:{email:'TIER3@test.hyrz.invalid',password:'Test-Only-Password-2026!',confirmPassword:'Test-Only-Password-2026!',role:'worker',nationalInsuranceNumber:'QQ987654C'}});assert.equal(r.status,409,JSON.stringify(r.data));});
  await check('Administrator email cannot be reused to create another administrator',async()=>{const r=await api('/admin/admins',{token:ownerToken,method:'POST',body:{email:'TIER3@test.hyrz.invalid',password:'Test-Only-Password-2026!',tier:3}});assert.equal(r.status,409,JSON.stringify(r.data));});
  const tier2Token=await login('tier2@test.hyrz.invalid'), tier3Token=await login('tier3@test.hyrz.invalid');
  await check('Tier 2 cannot create Tier 2 administrator',async()=>{const r=await api('/admin/admins',{token:tier2Token,method:'POST',body:{email:'forbidden@test.hyrz.invalid',password:'Test-Only-Password-2026!',tier:2}});assert.equal(r.status,403);});
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
    const r=await api('/admin/admins',{token:tier2Token,method:'POST',body:{email:'tier3b@test.hyrz.invalid',password:'Test-Only-Password-2026!',tier:3}});
    assert.equal(r.status,201,JSON.stringify(r.data));tier3bId=r.data.id;
  });
  await check('Tier 1 can deactivate a Tier 3 administrator',async()=>{
    const r=await api('/admin/admins/'+tier3bId,{token:ownerToken,method:'DELETE'});
    assert.equal(r.status,200,JSON.stringify(r.data));
    const [rows]=await db.execute('SELECT status FROM users WHERE id=?',[tier3bId]);assert.equal(rows[0].status,'pending_deletion');
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
  await check('Employer favourites and worker search return active workers',async()=>{
    const activeFavouriteWorkerId=await addUser({email:'favourite-worker@test.hyrz.invalid',ni:'QQ246810F'});
    await addUser({email:'favourite-employer@test.hyrz.invalid',role:'employer',company:'FAVOURITE-EMPLOYER-123'});
    const employerToken=await login('favourite-employer@test.hyrz.invalid');
    const added=await api('/employer/workers/'+activeFavouriteWorkerId+'/favourite',{token:employerToken,method:'POST'});
    assert.equal(added.status,200,JSON.stringify(added.data));
    const favourites=await api('/employer/workers/favourites',{token:employerToken});
    assert.equal(favourites.status,200,JSON.stringify(favourites.data));
    assert.ok(favourites.data.workers.some(worker=>Number(worker.id)===Number(activeFavouriteWorkerId)&&worker.isFavourite===true),'Favourite workers should load from the dedicated favourites endpoint.');
    const search=await api('/employer/workers/search?q=favourite-worker%40test.hyrz.invalid',{token:employerToken});
    assert.equal(search.status,200,JSON.stringify(search.data));
    assert.equal(search.data.radiusMiles,undefined,'Worker search must not hide active workers behind a distance radius.');
    assert.ok(search.data.workers.some(worker=>Number(worker.id)===Number(activeFavouriteWorkerId)),'Search by email should return the active worker.');
    const saved=await api('/shift-templates',{token:employerToken,method:'POST',body:{name:'Night Bartender',shift:{title:'Bartender',shiftType:'hospitality',hourlyPay:15,slots:8,startsAt:'ignored',endsAt:'ignored'},startTime:'20:00',endTime:'02:00'}});
    assert.equal(saved.status,201,JSON.stringify(saved.data));
    assert.equal(saved.data.template.shift.slots,undefined);
    assert.equal(saved.data.template.shift.startsAt,undefined);
    const list=await api('/shift-templates/mine',{token:employerToken});
    const loadedTemplate=list.data.templates.find(item=>Number(item.id)===Number(saved.data.template.id));
    assert.ok(loadedTemplate,'The saved template should persist in the employer template list.');
    assert.equal(loadedTemplate.shift.slots,undefined,'The stored template must not contain headcount.');
    assert.equal(loadedTemplate.shift.startsAt,undefined,'The stored template must not contain dates.');
    assert.equal(loadedTemplate.shift.description,undefined,'The stored template should only contain role, type and rate.');
    const removed=await api('/shift-templates/'+saved.data.template.id,{token:employerToken,method:'DELETE'});
    assert.equal(removed.status,200,JSON.stringify(removed.data));
  });
  await check('Shift publishing rejects invalid dates, rates and shift types',async()=>{
    const publisherId=await addUser({email:'shift-validation-employer@test.hyrz.invalid',role:'employer',company:'SHIFT-VALIDATION-123'});
    const publisherToken=await login('shift-validation-employer@test.hyrz.invalid');
    const start=new Date(Date.now()+48*60*60*1000);
    const end=new Date(start.getTime()+4*60*60*1000);
    const baseShift={title:'Bartender - Standard',description:'A test shift for validation.',location:'London',startsAt:start.toISOString().slice(0,19),endsAt:end.toISOString().slice(0,19),breakMinutes:0,hourlyPay:15,slots:1,autoApprove:false,shiftType:'hospitality',requirements:[],perks:[],preferences:[]};
    const lowPay=await api('/shifts',{token:publisherToken,method:'POST',body:{...baseShift,hourlyPay:7.99}});
    assert.equal(lowPay.status,400,'Pay below the configured platform floor must be rejected.');
    const badType=await api('/shifts',{token:publisherToken,method:'POST',body:{...baseShift,shiftType:'made-up-type'}});
    assert.equal(badType.status,400,'Unrecognized shift types must be rejected.');
    const badDate=await api('/shifts',{token:publisherToken,method:'POST',body:{...baseShift,startsAt:'not-a-date'}});
    assert.equal(badDate.status,400,'Malformed shift dates must be rejected.');
    const valid=await api('/shifts',{token:publisherToken,method:'POST',body:baseShift});
    assert.equal(valid.status,201,JSON.stringify(valid.data));
  });
  await check('Automatic shift approval respects the worker capacity',async()=>{
    const autoWorkerOne=await addUser({email:'auto-capacity-one@test.hyrz.invalid',ni:'QQ303030C'});
    const autoWorkerTwo=await addUser({email:'auto-capacity-two@test.hyrz.invalid',ni:'QQ404040D'});
    const autoEmployer=await addUser({email:'auto-capacity-employer@test.hyrz.invalid',role:'employer',company:'AUTO-CAPACITY-123'});
    const employerToken=await login('auto-capacity-employer@test.hyrz.invalid');
    const workerOneToken=await login('auto-capacity-one@test.hyrz.invalid');
    const workerTwoToken=await login('auto-capacity-two@test.hyrz.invalid');
    const [businessRows]=await db.execute('SELECT id FROM businesses WHERE owner_user_id=?',[autoEmployer]);
    const [shift]=await db.execute("INSERT INTO shifts(business_id,created_by,title,location,starts_at,ends_at,hourly_pay,slots,auto_approve,status) VALUES(?,?,'Bartender - Standard','London',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 53 HOUR),15,1,1,'open')",[businessRows[0].id,autoEmployer]);
    const applicationBody={contractAccepted:true,contractSnapshot:JSON.stringify({version:'hyrz-shift-contract-v1'}),confirmedRequirements:true,confirmedPreferences:[]};
    const first=await api('/shifts/'+shift.insertId+'/apply',{token:workerOneToken,method:'POST',body:applicationBody});
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal(first.data.status,'approved');
    const second=await api('/shifts/'+shift.insertId+'/apply',{token:workerTwoToken,method:'POST',body:applicationBody});
    assert.equal(second.status,409,JSON.stringify(second.data));
    const [approved]=await db.execute("SELECT COUNT(*) AS total FROM applications WHERE shift_id=? AND status='approved'",[shift.insertId]);
    assert.equal(Number(approved[0].total),1);
  });
  await check('Employer cannot approve more workers than a shift has positions',async()=>{
    const capacityWorkerOne=await addUser({email:'capacity-worker-one@test.hyrz.invalid',ni:'QQ101010A'});
    const capacityWorkerTwo=await addUser({email:'capacity-worker-two@test.hyrz.invalid',ni:'QQ202020B'});
    const capacityEmployer=await addUser({email:'capacity-employer@test.hyrz.invalid',role:'employer',company:'CAPACITY-EMPLOYER-123'});
    const employerToken=await login('capacity-employer@test.hyrz.invalid');
    const [businessRows]=await db.execute('SELECT id FROM businesses WHERE owner_user_id=?',[capacityEmployer]);
    const [shift]=await db.execute("INSERT INTO shifts(business_id,created_by,title,location,starts_at,ends_at,hourly_pay,slots,status) VALUES(?,?,'Capacity test shift','London',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 27 HOUR),15,1,'open')",[businessRows[0].id,capacityEmployer]);
    await db.execute("INSERT INTO applications(shift_id,worker_id,status) VALUES(?,?,'approved')",[shift.insertId,capacityWorkerOne]);
    const [pending]=await db.execute("INSERT INTO applications(shift_id,worker_id,status) VALUES(?,?,'pending')",[shift.insertId,capacityWorkerTwo]);
    const response=await api('/applications/'+pending.insertId,{token:employerToken,method:'PATCH',body:{status:'approved'}});
    assert.equal(response.status,409,JSON.stringify(response.data));
    const [rows]=await db.execute('SELECT status FROM applications WHERE id=?',[pending.insertId]);
    assert.equal(rows[0].status,'pending','A full shift must not overbook its worker slots.');
  });
  await check('Workchat replies quote the original message and enforce delete permissions',async()=>{
    const workchatWorkerId=await addUser({email:'workchat-worker@test.hyrz.invalid',ni:'QQ135790G'});
    await addUser({email:'workchat-employer@test.hyrz.invalid',role:'employer',company:'WORKCHAT-EMPLOYER-123'});
    const employerToken=await login('workchat-employer@test.hyrz.invalid');
    const workerToken=await login('workchat-worker@test.hyrz.invalid');
    const favourite=await api('/employer/workers/'+workchatWorkerId+'/favourite',{token:employerToken,method:'POST'});
    assert.equal(favourite.status,200,JSON.stringify(favourite.data));
    const created=await api('/workchats',{token:employerToken,method:'POST',body:{name:'Reply permissions test',participantIds:[workchatWorkerId]}});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const workchatId=created.data.workchatId;
    const initialLoad=await api('/workchats/'+workchatId+'/messages',{token:employerToken});
    assert.equal(initialLoad.status,200,JSON.stringify(initialLoad.data));
    const first=await api('/workchats/'+workchatId+'/messages',{token:employerToken,method:'POST',body:{body:'Can you confirm the start time?'}});
    assert.equal(first.status,201,JSON.stringify(first.data));
    const reply=await api('/workchats/'+workchatId+'/messages',{token:workerToken,method:'POST',body:{body:'Yes, I will arrive at nine.',replyToMessageId:first.data.id}});
    assert.equal(reply.status,201,JSON.stringify(reply.data));
    const history=await api('/workchats/'+workchatId+'/messages',{token:workerToken});
    assert.equal(history.status,200,JSON.stringify(history.data));
    const replyMessage=history.data.messages.find(message=>Number(message.id)===Number(reply.data.id));
    assert.equal(Number(replyMessage.reply_to_message_id),Number(first.data.id));
    assert.equal(replyMessage.reply_body,'Can you confirm the start time?');
    const forbiddenDelete=await api('/workchats/'+workchatId+'/messages/'+first.data.id,{token:workerToken,method:'DELETE'});
    assert.equal(forbiddenDelete.status,403,'A worker must not delete another participant’s message.');
    const ownDelete=await api('/workchats/'+workchatId+'/messages/'+reply.data.id,{token:workerToken,method:'DELETE'});
    assert.equal(ownDelete.status,200,JSON.stringify(ownDelete.data));
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
    const report=await api('/admin/financial-reports',{token:ownerToken});
    assert.equal(report.status,200);
    assert.ok(Number(report.data.invoices.invoicedRevenue)>=3,'Platform-fee revenue should include invoice fees.');
    assert.ok(Number(report.data.invoices.grossInvoiceValue)>=33,'Gross invoice value should include worker pay plus fees.');
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
    const loginChanged=await api('/auth/login',{method:'POST',body:{email:'tier3@test.hyrz.invalid',password:'Changed-Only-Password-2026!'}});
    assert.equal(loginChanged.status,200,JSON.stringify(loginChanged.data));
    const revokedSession=await api('/auth/me',{token:tier3Token});
    assert.equal(revokedSession.status,401,'Changing a password must invalidate previously issued sessions.');
  });
  await db.end();
  if(checks.some(c=>!c.ok)){console.error(JSON.stringify(checks,null,2));process.exitCode=1;}
  else console.log('All '+checks.length+' admin integration checks passed.');
}
main().catch(async e=>{console.error(e);try{await db.end();}catch(_){}process.exitCode=1;});
