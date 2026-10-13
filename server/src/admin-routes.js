const { auth, allow, adminTier } = require('./middleware');
const bcrypt = require('bcryptjs');

module.exports = function registerAdminRoutes(app, { db, asyncRoute, audit }) {
  const admin = [auth, allow('admin')];
  const ensureBlockedIdentifiers = db.query(`CREATE TABLE IF NOT EXISTS blocked_identifiers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, identifier_type ENUM('company_number','national_insurance','worker_permit') NOT NULL, identifier_hash CHAR(64) NOT NULL, blocked_user_id BIGINT UNSIGNED NULL, created_by BIGINT UNSIGNED NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_blocked_identifier(identifier_type,identifier_hash), FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL)`).catch(err=>{console.error('Could not initialise blocked identifiers:',err.message);throw err;});
  const ensureCheckoutCounterColumns = Promise.all([
    db.query('ALTER TABLE checkouts ADD COLUMN employer_comment TEXT NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
    db.query('ALTER TABLE checkouts ADD COLUMN counter_start DATETIME NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
    db.query('ALTER TABLE checkouts ADD COLUMN counter_end DATETIME NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
    db.query('ALTER TABLE checkouts ADD COLUMN counter_break_minutes INT NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
    db.query('ALTER TABLE checkouts ADD COLUMN counter_gross_pay DECIMAL(10,2) NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;})
  ]).catch(err=>{console.error('Could not initialise checkout counter-offer fields:',err.message);throw err;});
  const ensureWorkerIdentifierColumns = Promise.all([
    db.query('ALTER TABLE worker_profiles ADD COLUMN national_insurance_hash CHAR(64) NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
    db.query('ALTER TABLE worker_profiles ADD COLUMN worker_permit_hash CHAR(64) NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;})
  ]).catch(err=>{console.error('Could not initialise worker identifier hashes:',err.message);throw err;});

  const ensureMessageMeta = db.query(`CREATE TABLE IF NOT EXISTS admin_message_meta (message_id BIGINT UNSIGNED PRIMARY KEY, recipient_id BIGINT UNSIGNED NOT NULL, category VARCHAR(40) NOT NULL DEFAULT 'enquiries', subject VARCHAR(200) NULL, opened_by BIGINT UNSIGNED NULL, read_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE, FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL)`).then(async()=>{try { await db.query('ALTER TABLE admin_message_meta ADD COLUMN subject VARCHAR(200) NULL'); } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }}).catch(err => { console.error('Could not initialise admin message metadata:', err.message); throw err; });

  app.get('/api/admin/users', ...admin, asyncRoute(async (req, res) => {
    const { role, status } = req.query;
    const args = [];
    let where = [];
    if (role && ['admin','employer','worker'].includes(role)) { where.push('u.role=?'); args.push(role); }
    if (status && ['active','blocked','pending_deletion'].includes(status)) { where.push('u.status=?'); args.push(status); }
    const [users] = await db.execute(
      `SELECT u.id,u.email,u.role,u.admin_tier,u.first_name,u.last_name,u.phone,u.status,u.created_at,
        wp.postcode AS worker_postcode, wp.bio AS worker_bio,wp.skills AS worker_skills,wp.availability AS worker_availability,wp.hourly_rate AS worker_hourly_rate,wp.identity_verification_status AS worker_identity_status,wp.right_to_work_status AS worker_right_to_work_status,
        b.name AS business_name,b.company_number,b.postcode AS business_postcode,b.role_at_company,b.verification_status AS business_verification_status,b.identity_verification_status AS business_identity_status
       FROM users u LEFT JOIN worker_profiles wp ON wp.user_id=u.id
       LEFT JOIN businesses b ON b.owner_user_id=u.id
       ${where.length ? 'WHERE '+where.join(' AND ') : ''}
       ORDER BY u.created_at DESC LIMIT 500`, args);
    res.json({ users });
  }));

  app.patch('/api/admin/users/:id/status', ...admin, asyncRoute(async (req, res) => {
    const targetId = Number(req.params.id);
    const status = req.body.status;
    if (!Number.isSafeInteger(targetId) || !['active','blocked'].includes(status)) return res.status(400).json({error:'Invalid user or status'});
    if (Number(req.user.admin_tier) === 3) return res.status(403).json({error:'Tier 3 administrators cannot block or unblock users'});
    const [targetRows] = await db.execute('SELECT id,role,admin_tier,status FROM users WHERE id=?',[targetId]);
    if (!targetRows.length) return res.status(404).json({error:'User not found'});
    const target = targetRows[0];
    if (target.role === 'admin') return res.status(403).json({error:'Use administrator management to change administrator accounts'});
    await db.execute('UPDATE users SET status=? WHERE id=?',[status,targetId]);
    await ensureBlockedIdentifiers;
    if (status === 'blocked') {
      const identifiers=[];
      if (target.role==='employer') {
        const [businesses]=await db.execute('SELECT company_number FROM businesses WHERE owner_user_id=?',[targetId]);
        for (const b of businesses) if (b.company_number) identifiers.push(['company_number',String(b.company_number).replace(/\s+/g,'').toUpperCase()]);
      } else if (target.role==='worker') {
        await ensureWorkerIdentifierColumns;
        const [profiles]=await db.execute('SELECT national_insurance_hash,worker_permit_hash FROM worker_profiles WHERE user_id=?',[targetId]);
        for (const p of profiles) {
          if (p.national_insurance_hash) await db.execute("INSERT INTO blocked_identifiers(identifier_type,identifier_hash,blocked_user_id,created_by) VALUES('national_insurance',?,?,?) ON DUPLICATE KEY UPDATE blocked_user_id=VALUES(blocked_user_id),created_by=VALUES(created_by)",[p.national_insurance_hash,targetId,req.user.id]);
          if (p.worker_permit_hash) await db.execute("INSERT INTO blocked_identifiers(identifier_type,identifier_hash,blocked_user_id,created_by) VALUES('worker_permit',?,?,?) ON DUPLICATE KEY UPDATE blocked_user_id=VALUES(blocked_user_id),created_by=VALUES(created_by)",[p.worker_permit_hash,targetId,req.user.id]);
        }
      }
      for (const [type,value] of identifiers) {
        const hash=require('crypto').createHash('sha256').update(value).digest('hex');
        await db.execute('INSERT INTO blocked_identifiers(identifier_type,identifier_hash,blocked_user_id,created_by) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE blocked_user_id=VALUES(blocked_user_id),created_by=VALUES(created_by)',[type,hash,targetId,req.user.id]);
      }
    } else {
      const [businesses]=await db.execute('SELECT company_number FROM businesses WHERE owner_user_id=?',[targetId]);
      for (const b of businesses) if (b.company_number) {
        const hash=require('crypto').createHash('sha256').update(String(b.company_number).replace(/\s+/g,'').toUpperCase()).digest('hex');
        await db.execute("DELETE FROM blocked_identifiers WHERE identifier_type='company_number' AND identifier_hash=? AND blocked_user_id=?",[hash,targetId]);
      }
      if (target.role==='worker') {
        await ensureWorkerIdentifierColumns;
        const [profiles]=await db.execute('SELECT national_insurance_hash,worker_permit_hash FROM worker_profiles WHERE user_id=?',[targetId]);
        for (const p of profiles) {
          if (p.national_insurance_hash) await db.execute("DELETE FROM blocked_identifiers WHERE identifier_type='national_insurance' AND identifier_hash=? AND blocked_user_id=?",[p.national_insurance_hash,targetId]);
          if (p.worker_permit_hash) await db.execute("DELETE FROM blocked_identifiers WHERE identifier_type='worker_permit' AND identifier_hash=? AND blocked_user_id=?",[p.worker_permit_hash,targetId]);
        }
      }
    }
    await audit(req, status === 'blocked' ? 'user.blocked' : 'user.unblocked', 'user', targetId, { previousStatus:target.status, status });
    res.json({ok:true,status});
  }));

  const ensureReferralCommissions = db.query(`CREATE TABLE IF NOT EXISTS referral_commissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, referrer_user_id BIGINT UNSIGNED NOT NULL, referred_user_id BIGINT UNSIGNED NOT NULL, amount DECIMAL(10,2) NOT NULL, status ENUM('pending','approved','paid','cancelled') NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, paid_at DATETIME NULL, UNIQUE KEY uq_referral_pair(referrer_user_id,referred_user_id), FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE)`).catch(err=>{console.error('Could not initialise referral commission ledger:',err.message);throw err;});

  app.get('/api/admin/financial-reports', ...admin, asyncRoute(async(req,res) => {
    if (Number(req.user.admin_tier)!==1) return res.status(403).json({error:'Financial reports are available to Tier 1 administrators only'});
    await ensureReferralCommissions;
    const [[userCounts]]=await db.query(`SELECT COUNT(*) AS totalUsers,
      SUM(role='worker') AS workers,SUM(role='employer') AS clients,SUM(role='admin') AS admins,
      SUM(status='blocked') AS blockedUsers FROM users`);
    const [[invoiceTotals]]=await db.query(`SELECT COUNT(*) AS invoiceCount,
      COALESCE(SUM(total),0) AS invoicedRevenue,
      COALESCE(SUM(CASE WHEN status='paid' THEN total ELSE 0 END),0) AS paidRevenue,
      COALESCE(SUM(CASE WHEN status IN ('issued','overdue') OR (status='issued' AND due_at<CURRENT_DATE) THEN total ELSE 0 END),0) AS outstandingRevenue,
      SUM(status='paid') AS paidInvoices,
      SUM(status='overdue' OR (status='issued' AND due_at<CURRENT_DATE)) AS overdueInvoices FROM invoices`);
    const [[commissions]]=await db.query(`SELECT COUNT(*) AS commissionCount,
      COALESCE(SUM(amount),0) AS totalCommissionLiability,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) AS pendingCommissions,
      COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END),0) AS approvedCommissions,
      COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS paidCommissions FROM referral_commissions`);
    const [referralRows]=await db.execute(`SELECT rc.*,r.email AS referrer_email,rr.email AS referred_email
      FROM referral_commissions rc JOIN users r ON r.id=rc.referrer_user_id JOIN users rr ON rr.id=rc.referred_user_id
      ORDER BY rc.created_at DESC LIMIT 500`);
    res.json({userCounts,invoices:invoiceTotals,commissions,referralCommissions:referralRows});
  }));

  app.patch('/api/admin/referral-commissions/:id/status', ...admin, asyncRoute(async(req,res) => {
    if (Number(req.user.admin_tier)!==1) return res.status(403).json({error:'Only Tier 1 can update referral commissions'});
    const status=req.body.status;
    if (!['pending','approved','paid','cancelled'].includes(status)) return res.status(400).json({error:'Invalid commission status'});
    await ensureReferralCommissions;
    const [result]=await db.execute("UPDATE referral_commissions SET status=?,paid_at=IF(?='paid',UTC_TIMESTAMP(),NULL) WHERE id=?",[status,status,req.params.id]);
    if (!result.affectedRows) return res.status(404).json({error:'Referral commission not found'});
    await audit(req,'referral_commission.status_changed','referral_commission',req.params.id,{status});
    res.json({ok:true,status});
  }));

  app.delete('/api/admin/users/:id', ...admin, asyncRoute(async(req,res) => {
    const targetId=Number(req.params.id);
    if (Number(req.user.admin_tier)===3) return res.status(403).json({error:'Tier 3 administrators cannot delete users'});
    if (!Number.isSafeInteger(targetId) || targetId===Number(req.user.id)) return res.status(400).json({error:'Invalid user id'});
    const [targets]=await db.execute('SELECT id,email,role,status FROM users WHERE id=?',[targetId]);
    if (!targets.length) return res.status(404).json({error:'User not found'});
    if (targets[0].role==='admin') return res.status(403).json({error:'Use Tier 1 administrator management to delete administrators'});
    await db.execute("UPDATE users SET status='pending_deletion' WHERE id=?",[targetId]);
    await audit(req,'user.deletion_requested','user',targetId,{email:targets[0].email,role:targets[0].role,previousStatus:targets[0].status});
    res.json({ok:true,status:'pending_deletion',message:'Account access disabled and deletion recorded. Related financial and audit records are retained.'});
  }));

  app.get('/api/admin/invoices', ...admin, asyncRoute(async (req,res) => {
    const [rows] = await db.execute(`
      SELECT i.*, b.name AS business_name,b.company_number,b.postcode AS business_postcode,
        u.id AS client_user_id,u.email AS client_email,u.first_name AS client_first_name,
        u.last_name AS client_last_name,u.phone AS client_phone,
        c.worker_id,w.email AS worker_email,w.first_name AS worker_first_name,w.last_name AS worker_last_name,
        s.title AS shift_title,s.location AS shift_location
      FROM invoices i JOIN businesses b ON b.id=i.business_id
      JOIN users u ON u.id=b.owner_user_id
      JOIN checkouts c ON c.id=i.checkout_id JOIN users w ON w.id=c.worker_id
      JOIN shifts s ON s.id=c.shift_id
      ORDER BY CASE WHEN i.status='overdue' OR (i.status='issued' AND i.due_at<CURRENT_DATE) THEN 0 ELSE 1 END,
        i.due_at ASC LIMIT 500`);
    for (const invoice of rows) if (invoice.status === 'issued' && new Date(invoice.due_at) < new Date(new Date().toISOString().slice(0,10))) invoice.status = 'overdue';
    res.json({invoices:rows});
  }));

  app.patch('/api/admin/invoices/:id/status', ...admin, asyncRoute(async(req,res) => {
    const status=req.body.status;
    if (!['issued','paid','overdue','void'].includes(status)) return res.status(400).json({error:'Invalid invoice status'});
    const [result]=await db.execute('UPDATE invoices SET status=? WHERE id=?',[status,req.params.id]);
    if (!result.affectedRows) return res.status(404).json({error:'Invoice not found'});
    await audit(req,'invoice.status_changed','invoice',req.params.id,{status});
    res.json({ok:true,status});
  }));

  app.get('/api/admin/audit-logs', ...admin, asyncRoute(async(req,res) => {
    const [logs]=await db.execute(`SELECT a.*,u.email AS admin_email,u.first_name AS admin_first_name,u.last_name AS admin_last_name,u.admin_tier
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 500`);
    res.json({logs});
  }));

  app.get('/api/admin/disputes', ...admin, asyncRoute(async(req,res) => {
    await ensureCheckoutCounterColumns;
    const [disputes]=await db.execute(`SELECT d.*, c.actual_start,c.actual_end,c.break_minutes,c.gross_pay,c.platform_fee,c.worker_comment,c.employer_comment,c.counter_start,c.counter_end,c.counter_break_minutes,c.counter_gross_pay,
      c.status AS checkout_status,c.worker_id,w.email AS worker_email,w.first_name AS worker_first_name,w.last_name AS worker_last_name,
      s.title AS shift_title,s.location AS shift_location,b.name AS business_name,eu.email AS employer_email,
      eu.first_name AS employer_first_name,eu.last_name AS employer_last_name, opener.email AS opened_by_email,
      assignee.email AS assigned_admin_email
      FROM disputes d JOIN checkouts c ON c.id=d.checkout_id JOIN users w ON w.id=c.worker_id
      JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id JOIN users eu ON eu.id=b.owner_user_id
      JOIN users opener ON opener.id=d.opened_by LEFT JOIN users assignee ON assignee.id=d.assigned_to
      ORDER BY FIELD(d.status,'open','assigned','resolved','rejected'),d.created_at DESC LIMIT 500`);
    res.json({disputes});
  }));

  app.patch('/api/admin/disputes/:id/assign', ...admin, asyncRoute(async(req,res) => {
    const [result]=await db.execute("UPDATE disputes SET status='assigned',assigned_to=? WHERE id=? AND status IN ('open','assigned')",[req.user.id,req.params.id]);
    if (!result.affectedRows) return res.status(409).json({error:'Dispute is not open for assignment'});
    await audit(req,'dispute.assigned','dispute',req.params.id,{assignedTo:req.user.id});
    res.json({ok:true});
  }));

  app.patch('/api/admin/disputes/:id/resolve', ...admin, asyncRoute(async(req,res) => {
    await ensureCheckoutCounterColumns;
    const { outcome, resolution, actualStart, actualEnd, breakMinutes }=req.body||{};
    if (!['worker','employer','reject'].includes(outcome) || typeof resolution!=='string' || resolution.trim().length<5) return res.status(400).json({error:'Choose an outcome and provide a resolution of at least 5 characters'});
    const [rows]=await db.execute('SELECT checkout_id FROM disputes WHERE id=? AND status IN (\'open\',\'assigned\')',[req.params.id]);
    if (!rows.length) return res.status(404).json({error:'Open dispute not found'});
    const checkoutId=rows[0].checkout_id;
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      if (outcome!=='reject') {
        const fields=[],args=[];
        if (actualStart) {fields.push('actual_start=?');args.push(actualStart);}
        if (actualEnd) {fields.push('actual_end=?');args.push(actualEnd);}
        if (breakMinutes!==undefined && Number.isInteger(Number(breakMinutes)) && Number(breakMinutes)>=0) {fields.push('break_minutes=?');args.push(Number(breakMinutes));}
        if (outcome==='employer') fields.push('gross_pay=COALESCE(counter_gross_pay,gross_pay)');
        fields.push("status='approved'","reviewed_by=?","reviewed_at=UTC_TIMESTAMP()");args.push(req.user.id,checkoutId);
        await conn.execute('UPDATE checkouts SET '+fields.join(',')+' WHERE id=?',args);
        await conn.execute("INSERT IGNORE INTO invoices(business_id,checkout_id,subtotal,platform_fee,total,due_at,status) SELECT s.business_id,c.id,c.gross_pay,c.platform_fee,c.gross_pay+c.platform_fee,DATE_ADD(CURRENT_DATE,INTERVAL 14 DAY),'issued' FROM checkouts c JOIN shifts s ON s.id=c.shift_id WHERE c.id=?",[checkoutId]);
      } else {
        await conn.execute("UPDATE checkouts SET status='rejected',reviewed_by=?,reviewed_at=UTC_TIMESTAMP() WHERE id=?",[req.user.id,checkoutId]);
      }
      await conn.execute("UPDATE disputes SET status=?,resolution=?,assigned_to=?,resolved_at=UTC_TIMESTAMP() WHERE id=?",[outcome==='reject'?'rejected':'resolved',resolution.trim(),req.user.id,req.params.id]);
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
    await audit(req,'dispute.resolved','dispute',req.params.id,{outcome,resolution:resolution.trim(),checkoutId,actualStart:actualStart||null,actualEnd:actualEnd||null,breakMinutes:breakMinutes??null});
    res.json({ok:true});
  }));

  app.get('/api/admin/inbox', ...admin, asyncRoute(async(req,res) => {
    await ensureMessageMeta;
    const [rows]=await db.execute(`SELECT m.*,u.email AS sender_email,u.role AS sender_role,u.first_name,u.last_name,meta.recipient_id,meta.category,meta.subject,meta.opened_by,meta.read_at,opener.email AS opened_by_email
      FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN admin_message_meta meta ON meta.message_id=m.id LEFT JOIN users opener ON opener.id=meta.opened_by ORDER BY m.created_at DESC LIMIT 500`);
    res.json({messages:rows});
  }));

  app.post('/api/admin/messages', ...admin, asyncRoute(async(req,res) => {
    const { recipientId, category='enquiries', subject='', body }=req.body||{};
    const categories=['checkout_disputes','complaints','enquiries','admins'];
    if (!Number.isSafeInteger(Number(recipientId)) || !categories.includes(category) || typeof subject!=='string' || subject.length>200 || typeof body!=='string' || body.trim().length<1 || body.length>5000) return res.status(400).json({error:'Recipient, category and message are required'});
    const [recipients]=await db.execute('SELECT id,role FROM users WHERE id=? AND status=\'active\'',[recipientId]);
    if (!recipients.length) return res.status(404).json({error:'Recipient not found'});
    if (category==='admins' && recipients[0].role!=='admin') return res.status(400).json({error:'Admin messages must be sent to an administrator'});
    if (category!=='admins' && recipients[0].role==='admin') return res.status(400).json({error:'Choose the admin message category for administrator messages'});
    const conversationKey=[Number(req.user.id),Number(recipientId)].sort((a,b)=>a-b).join(':');
    await ensureMessageMeta;
    const [result]=await db.execute('INSERT INTO messages(conversation_key,sender_id,body) VALUES(?,?,?)',[conversationKey,req.user.id,body.trim()]);
    await db.execute('INSERT INTO admin_message_meta(message_id,recipient_id,category,subject) VALUES(?,?,?,?)',[result.insertId,Number(recipientId),category,subject.trim()||null]);
    await audit(req,'message.sent','message',result.insertId,{recipientId:Number(recipientId),category});
    res.status(201).json({ok:true,id:result.insertId});
  }));

  app.patch('/api/admin/messages/:id/claim', ...admin, asyncRoute(async(req,res) => {
    await ensureMessageMeta;
    const [current]=await db.execute('SELECT opened_by FROM admin_message_meta WHERE message_id=?',[req.params.id]);
    if (!current.length) return res.status(404).json({error:'Message not found'});
    if (current[0].opened_by && Number(current[0].opened_by)!==Number(req.user.id)) return res.status(409).json({error:'This issue is already being handled by another administrator'});
    await db.execute('UPDATE admin_message_meta SET opened_by=? WHERE message_id=?',[req.user.id,req.params.id]);
    await audit(req,'message.claimed','message',req.params.id);
    res.json({ok:true});
  }));

  app.patch('/api/admin/messages/:id/read', ...admin, asyncRoute(async(req,res) => {
    await ensureMessageMeta;
    const [result]=await db.execute('UPDATE admin_message_meta SET read_at=UTC_TIMESTAMP() WHERE message_id=? AND recipient_id=?',[req.params.id,req.user.id]);
    if (!result.affectedRows) return res.status(404).json({error:'Message not found for this administrator'});
    await audit(req,'message.read','message',req.params.id);
    res.json({ok:true});
  }));

  app.post('/api/admin/admins', ...admin, asyncRoute(async(req,res) => {
    const tier=Number(req.body.tier), email=String(req.body.email||'').trim().toLowerCase(), username=String(req.body.username||'').trim(), password=req.body.password;
    if (Number(req.user.admin_tier)>2) return res.status(403).json({error:'Tier 3 administrators cannot create administrators'});
    if (![2,3].includes(tier) || (Number(req.user.admin_tier)===2 && tier!==3)) return res.status(403).json({error:'You cannot create an administrator at that tier'});
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^[A-Za-z][A-Za-z0-9._-]{2,79}$/.test(username) || typeof password!=='string' || password.length<12) return res.status(400).json({error:'Enter a valid email, username (3-80 characters) and password of at least 12 characters'});
    const hash=await bcrypt.hash(password,12);
    const conn=await db.getConnection();
    let userId;
    try {
      await conn.beginTransaction();
      const [result]=await conn.execute("INSERT INTO users(email,password_hash,role,admin_tier,status,email_verified_at) VALUES(?,?,'admin',?,'active',UTC_TIMESTAMP())",[email,hash,tier]);
      userId=result.insertId;
      await conn.execute('INSERT INTO admin_login_names(user_id,username) VALUES(?,?)',[userId,username]);
      await conn.commit();
    } catch(error) {
      try { await conn.rollback(); } catch (_) {}
      if(error.code==='ER_DUP_ENTRY') return res.status(409).json({error:'That email or username is already in use'});
      throw error;
    } finally { conn.release(); }
    await audit(req,'admin.created','user',userId,{email,username,tier});
    res.status(201).json({id:userId,email,username,tier});
  }));

  app.patch('/api/admin/admins/:id/tier', ...admin, asyncRoute(async(req,res) => {
    const targetId=Number(req.params.id), tier=Number(req.body.tier);
    if (Number(req.user.admin_tier)!==1) return res.status(403).json({error:'Only Tier 1 can change administrator tiers'});
    if (!Number.isSafeInteger(targetId) || ![2,3].includes(tier)) return res.status(400).json({error:'Choose Tier 2 or Tier 3'});
    if (targetId===Number(req.user.id)) return res.status(400).json({error:'You cannot change your own tier'});
    const [targets]=await db.execute("SELECT id,email,role,admin_tier FROM users WHERE id=? AND role='admin'",[targetId]);
    if (!targets.length) return res.status(404).json({error:'Administrator not found'});
    await db.execute('UPDATE users SET admin_tier=? WHERE id=?',[tier,targetId]);
    await audit(req,'admin.tier_changed','user',targetId,{email:targets[0].email,previousTier:targets[0].admin_tier,tier});
    res.json({ok:true,tier});
  }));

  app.delete('/api/admin/admins/:id', ...admin, asyncRoute(async(req,res) => {
    const targetId=Number(req.params.id);
    if (Number(req.user.admin_tier)!==1) return res.status(403).json({error:'Only Tier 1 can delete administrators'});
    if (!Number.isSafeInteger(targetId) || targetId===Number(req.user.id)) return res.status(400).json({error:'Invalid administrator id'});
    const [targets]=await db.execute("SELECT id,email,admin_tier FROM users WHERE id=? AND role='admin'",[targetId]);
    if (!targets.length) return res.status(404).json({error:'Administrator not found'});
    await db.execute("UPDATE users SET status='pending_deletion' WHERE id=?",[targetId]);
    await audit(req,'admin.deletion_requested','user',targetId,{email:targets[0].email,tier:targets[0].admin_tier});
    res.json({ok:true,status:'pending_deletion',message:'Administrator access disabled; historical records retained.'});
  }));

  app.post('/api/admin/change-password', ...admin, asyncRoute(async(req,res) => {
    const {currentPassword,newPassword}=req.body||{};
    if (typeof newPassword!=='string'||newPassword.length<12) return res.status(400).json({error:'New password must be at least 12 characters'});
    const [rows]=await db.execute('SELECT password_hash FROM users WHERE id=?',[req.user.id]);
    if (!rows.length || !await bcrypt.compare(String(currentPassword||''),rows[0].password_hash)) return res.status(400).json({error:'Current password is incorrect'});
    await db.execute('UPDATE users SET password_hash=? WHERE id=?',[await bcrypt.hash(newPassword,12),req.user.id]);
    await audit(req,'admin.password_changed','user',req.user.id);
    res.json({ok:true});
  }));
};
