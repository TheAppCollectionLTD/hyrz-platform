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
};
