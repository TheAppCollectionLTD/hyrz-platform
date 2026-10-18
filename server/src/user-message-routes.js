const { auth, allow } = require('./middleware');

module.exports = function registerUserMessageRoutes(app, { db, asyncRoute, audit }) {
  const ensureMeta = db.query(`CREATE TABLE IF NOT EXISTS admin_message_meta (message_id BIGINT UNSIGNED PRIMARY KEY, recipient_id BIGINT UNSIGNED NOT NULL, category VARCHAR(40) NOT NULL DEFAULT 'enquiries', subject VARCHAR(200) NULL, opened_by BIGINT UNSIGNED NULL, read_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE, FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL)`).then(async()=>{
    try { await db.query('ALTER TABLE admin_message_meta ADD COLUMN subject VARCHAR(200) NULL'); }
    catch(e) { if(e.code!=='ER_DUP_FIELDNAME') throw e; }
  });

  app.post('/api/messages', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    const category=String(req.body.category||'enquiries');
    const subject=String(req.body.subject||'').trim();
    const body=String(req.body.body||'').trim();
    if (!['checkout_disputes','complaints','enquiries'].includes(category)) return res.status(400).json({error:'Choose a valid message subject category'});
    if (subject.length<2||subject.length>200||body.length<1||body.length>5000) return res.status(400).json({error:'Subject must be 2-200 characters and message 1-5000 characters'});
    await ensureMeta;
    let recipientId=Number(req.body.recipientId)||0;
    if (recipientId) {
      const [admins]=await db.execute("SELECT id FROM users WHERE id=? AND role='admin' AND status='active'",[recipientId]);
      if (!admins.length) return res.status(404).json({error:'Administrator not found'});
    } else {
      const [admins]=await db.execute("SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY admin_tier ASC,id ASC LIMIT 1");
      if (!admins.length) return res.status(503).json({error:'Support is temporarily unavailable'});
      recipientId=Number(admins[0].id);
    }
    const conversationKey=[Number(req.user.id),recipientId].sort((a,b)=>a-b).join(':');
    const [result]=await db.execute('INSERT INTO messages(conversation_key,sender_id,body) VALUES(?,?,?)',[conversationKey,req.user.id,body]);
    await db.execute('INSERT INTO admin_message_meta(message_id,recipient_id,category,subject) VALUES(?,?,?,?)',[result.insertId,recipientId,category,subject]);
    await audit(req,'message.sent','message',result.insertId,{recipientId,category,subject});
    res.status(201).json({ok:true,id:result.insertId,message:'Your message has been sent to hyrz support.'});
  }));

  app.get('/api/messages/mine', auth, asyncRoute(async(req,res) => {
    await ensureMeta;
    const [messages]=await db.execute(`SELECT m.id,m.body,m.created_at,m.sender_id,meta.category,meta.subject,meta.read_at,meta.recipient_id,
      sender.email AS sender_email,sender.role AS sender_role,recipient.email AS recipient_email,recipient.role AS recipient_role
      FROM messages m JOIN admin_message_meta meta ON meta.message_id=m.id
      JOIN users sender ON sender.id=m.sender_id JOIN users recipient ON recipient.id=meta.recipient_id
      WHERE m.sender_id=? OR meta.recipient_id=? ORDER BY m.created_at DESC LIMIT 200`,[req.user.id,req.user.id]);
    res.json({messages});
  }));
  // Direct employer-worker conversations, separate from support/admin messages.
  const ensureDirectMessages = Promise.all([
    db.query(`CREATE TABLE IF NOT EXISTS employer_worker_conversations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      employer_user_id BIGINT UNSIGNED NOT NULL,
      worker_user_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY unique_employer_worker_conversation (employer_user_id, worker_user_id),
      KEY idx_direct_conversation_employer (employer_user_id,last_message_at),
      KEY idx_direct_conversation_worker (worker_user_id,last_message_at)
    ) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS employer_worker_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      conversation_id BIGINT UNSIGNED NOT NULL,
      sender_id BIGINT UNSIGNED NOT NULL,
      body TEXT NOT NULL,
      read_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_direct_messages_conversation (conversation_id,created_at),
      KEY idx_direct_messages_unread (conversation_id,read_at)
    ) ENGINE=InnoDB`)
  ]);

  app.get('/api/conversations/mine', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    await ensureDirectMessages;
    const isEmployer=req.user.role==='employer';
    const ownerColumn=isEmployer?'c.employer_user_id':'c.worker_user_id';
    const [rows]=await db.execute(`
      SELECT c.id,c.employer_user_id,c.worker_user_id,c.created_at,c.last_message_at,
        u.id AS participant_id,u.first_name AS participant_first_name,u.last_name AS participant_last_name,u.email AS participant_email,
        (SELECT COUNT(*) FROM employer_worker_messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.read_at IS NULL) AS unread_count,
        (SELECT m.body FROM employer_worker_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message
      FROM employer_worker_conversations c
      JOIN users u ON u.id=IF(?=1,c.worker_user_id,c.employer_user_id)
      WHERE ${ownerColumn}=?
      ORDER BY COALESCE(c.last_message_at,c.created_at) DESC,c.id DESC
    `,[req.user.id,isEmployer?1:0,req.user.id]);
    res.json({conversations:rows.map(row=>({...row,unread_count:Number(row.unread_count||0)}))});
  }));

  app.post('/api/conversations', auth, allow('employer'), asyncRoute(async(req,res) => {
    await ensureDirectMessages;
    const workerId=Number(req.body.workerId);
    if(!Number.isInteger(workerId)||workerId<1)return res.status(400).json({error:'Choose a worker to start a conversation.'});
    const [workers]=await db.execute("SELECT id FROM users WHERE id=? AND role='worker' AND status='active'",[workerId]);
    if(!workers.length)return res.status(404).json({error:'Active worker not found.'});
    await db.execute('INSERT IGNORE INTO employer_worker_conversations(employer_user_id,worker_user_id) VALUES(?,?)',[req.user.id,workerId]);
    const [rows]=await db.execute('SELECT id FROM employer_worker_conversations WHERE employer_user_id=? AND worker_user_id=?',[req.user.id,workerId]);
    res.status(201).json({conversationId:Number(rows[0].id)});
  }));

  app.get('/api/conversations/:id/messages', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    await ensureDirectMessages;
    const id=Number(req.params.id);
    const [conversations]=await db.execute('SELECT id FROM employer_worker_conversations WHERE id=? AND (employer_user_id=? OR worker_user_id=?)',[id,req.user.id,req.user.id]);
    if(!conversations.length)return res.status(404).json({error:'Conversation not found.'});
    await db.execute('UPDATE employer_worker_messages SET read_at=NOW() WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL',[id,req.user.id]);
    const [messages]=await db.execute(`SELECT m.id,m.conversation_id,m.sender_id,m.body,m.read_at,m.created_at,u.first_name AS sender_first_name,u.last_name AS sender_last_name,u.role AS sender_role
      FROM employer_worker_messages m JOIN users u ON u.id=m.sender_id
      WHERE m.conversation_id=? ORDER BY m.created_at ASC,m.id ASC`,[id]);
    res.json({messages});
  }));

  app.post('/api/conversations/:id/messages', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    await ensureDirectMessages;
    const id=Number(req.params.id),body=String(req.body.body||'').trim();
    if(!body||body.length>5000)return res.status(400).json({error:'Enter a message of 1-5000 characters.'});
    const [conversations]=await db.execute('SELECT id FROM employer_worker_conversations WHERE id=? AND (employer_user_id=? OR worker_user_id=?)',[id,req.user.id,req.user.id]);
    if(!conversations.length)return res.status(404).json({error:'Conversation not found.'});
    const [result]=await db.execute('INSERT INTO employer_worker_messages(conversation_id,sender_id,body) VALUES(?,?,?)',[id,req.user.id,body]);
    await db.execute('UPDATE employer_worker_conversations SET last_message_at=NOW() WHERE id=?',[id]);
    await audit(req,'direct_message.sent','conversation',id,{messageId:result.insertId});
    res.status(201).json({ok:true,id:result.insertId});
  }));

};
