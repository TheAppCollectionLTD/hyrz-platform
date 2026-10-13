const { auth, allow, adminTier } = require('./middleware');
const bcrypt = require('bcryptjs');

module.exports = function registerAdminRoutes(app, { db, asyncRoute, audit }) {
  const admin = [auth, allow('admin')];
  const ensureMessageMeta = db.query(`CREATE TABLE IF NOT EXISTS admin_message_meta (message_id BIGINT UNSIGNED PRIMARY KEY, recipient_id BIGINT UNSIGNED NOT NULL, category VARCHAR(40) NOT NULL DEFAULT 'enquiries', opened_by BIGINT UNSIGNED NULL, read_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE, FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL)`).catch(err => { console.error('Could not initialise admin message metadata:', err.message); throw err; });

  app.get('/api/admin/users', ...admin, asyncRoute(async (req, res) => {
    const { role, status } = req.query;
    const args = [];
    let where = [];
    if (role && ['admin','employer','worker'].includes(role)) { where.push('u.role=?'); args.push(role); }
    if (status && ['active','blocked','pending_deletion'].includes(status)) { where.push('u.status=?'); args.push(status); }
    const [users] = await db.execute(
      `SELECT u.id,u.email,u.role,u.admin_tier,u.first_name,u.last_name,u.phone,u.status,u.created_at,
        wp.postcode AS worker_postcode, wp.bio AS worker_bio,
        b.name AS business_name,b.company_number,b.postcode AS business_postcode,b.role_at_company
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
    await audit(req, status === 'blocked' ? 'user.blocked' : 'user.unblocked', 'user', targetId, { previousStatus:target.status, status });
    res.json({ok:true,status});
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
    const [disputes]=await db.execute(`SELECT d.*, c.actual_start,c.actual_end,c.break_minutes,c.gross_pay,c.platform_fee,c.worker_comment,
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
        fields.push("status='approved'","reviewed_by=?","reviewed_at=UTC_TIMESTAMP()");args.push(req.user.id,checkoutId);
        await conn.execute('UPDATE checkouts SET '+fields.join(',')+' WHERE id=?',args);
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
    const [rows]=await db.execute(`SELECT m.*,u.email AS sender_email,u.role AS sender_role,u.first_name,u.last_name,meta.recipient_id,meta.category,meta.opened_by,meta.read_at,opener.email AS opened_by_email
      FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN admin_message_meta meta ON meta.message_id=m.id LEFT JOIN users opener ON opener.id=meta.opened_by ORDER BY m.created_at DESC LIMIT 500`);
    res.json({messages:rows});
  }));

  app.post('/api/admin/messages', ...admin, asyncRoute(async(req,res) => {
    const { recipientId, category='enquiries', body }=req.body||{};
    const categories=['checkout_disputes','complaints','enquiries','admins'];
    if (!Number.isSafeInteger(Number(recipientId)) || !categories.includes(category) || typeof body!=='string' || body.trim().length<1 || body.length>5000) return res.status(400).json({error:'Recipient, category and message are required'});
    const [recipients]=await db.execute('SELECT id,role FROM users WHERE id=? AND status=\'active\'',[recipientId]);
    if (!recipients.length) return res.status(404).json({error:'Recipient not found'});
    if (category==='admins' && recipients[0].role!=='admin') return res.status(400).json({error:'Admin messages must be sent to an administrator'});
    if (category!=='admins' && recipients[0].role==='admin') return res.status(400).json({error:'Choose the admin message category for administrator messages'});
    const conversationKey=[Number(req.user.id),Number(recipientId)].sort((a,b)=>a-b).join(':');
    await ensureMessageMeta;
    const [result]=await db.execute('INSERT INTO messages(conversation_key,sender_id,body) VALUES(?,?,?)',[conversationKey,req.user.id,body.trim()]);
    await db.execute('INSERT INTO admin_message_meta(message_id,recipient_id,category) VALUES(?,?,?)',[result.insertId,Number(recipientId),category]);
    await audit(req,'message.sent','message',result.insertId,{recipientId:Number(recipientId),category});
    res.status(201).json({ok:true,id:result.insertId});
  }));

  app.patch('/api/admin/messages/:id/claim', ...admin, asyncRoute(async(req,res) => {
    await ensureMessageMeta;
    const [result]=await db.execute('UPDATE admin_message_meta SET opened_by=? WHERE message_id=? AND (opened_by IS NULL OR opened_by=?)',[req.user.id,req.params.id,req.user.id]);
    if (!result.affectedRows) return res.status(409).json({error:'This issue is already being handled by another administrator'});
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
    if (!/^\\S+@\\S+\\.\\S+$/.test(email) || !/^[A-Za-z][A-Za-z0-9._-]{2,79}$/.test(username) || typeof password!=='string' || password.length<12) return res.status(400).json({error:'Enter a valid email, username (3-80 characters) and password of at least 12 characters'});
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
