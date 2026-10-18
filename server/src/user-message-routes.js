const { auth, allow } = require('./middleware');

module.exports = function registerUserMessageRoutes(app, { db, asyncRoute, audit }) {
  // Initialise support-message metadata once, avoiding unconditional ALTER TABLE calls.
  // Running ALTER on every server start can deadlock when another app instance or migration
  // is touching the same table. Re-check the schema and retry transient lock conflicts.
  const ensureMeta = (async()=>{
    await db.query(`CREATE TABLE IF NOT EXISTS admin_message_meta (message_id BIGINT UNSIGNED PRIMARY KEY, recipient_id BIGINT UNSIGNED NOT NULL, category VARCHAR(40) NOT NULL DEFAULT 'enquiries', subject VARCHAR(200) NULL, opened_by BIGINT UNSIGNED NULL, read_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE, FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL)`);
    for(let attempt=0;attempt<4;attempt++){
      const [columns]=await db.query("SHOW COLUMNS FROM admin_message_meta LIKE 'subject'");
      if(columns.length)return;
      try{
        await db.query('ALTER TABLE admin_message_meta ADD COLUMN subject VARCHAR(200) NULL');
        return;
      }catch(e){
        if(e.code==='ER_DUP_FIELDNAME')return;
        if(!['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(e.code)||attempt===3)throw e;
        await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
      }
    }
  })();

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

  const ensureGroupWorkchats = Promise.all([
    db.query(`CREATE TABLE IF NOT EXISTS workchats (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, employer_user_id BIGINT UNSIGNED NOT NULL, name VARCHAR(100) NOT NULL, status ENUM('current','past') NOT NULL DEFAULT 'current', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_message_at TIMESTAMP NULL DEFAULT NULL, KEY idx_workchat_employer (employer_user_id,status,last_message_at)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_participants (workchat_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,last_read_at DATETIME NULL,PRIMARY KEY(workchat_id,user_id),KEY idx_workchat_user(user_id,workchat_id)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_messages (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,workchat_id BIGINT UNSIGNED NOT NULL,sender_id BIGINT UNSIGNED NOT NULL,body TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,KEY idx_workchat_message(workchat_id,created_at,id)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_typing (workchat_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,updated_at DATETIME NOT NULL,PRIMARY KEY(workchat_id,user_id)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_settings (workchat_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,disabled TINYINT(1) NOT NULL DEFAULT 0,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_admins (workchat_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(workchat_id,user_id)) ENGINE=InnoDB`)
  ]);
  async function getWorkchat(id,userId) {
    const [rows]=await db.execute(`SELECT w.*,COALESCE(s.disabled,0) AS disabled,EXISTS(SELECT 1 FROM workchat_admins wa WHERE wa.workchat_id=w.id AND wa.user_id=?) AS is_workchat_admin FROM workchats w LEFT JOIN workchat_participants p ON p.workchat_id=w.id AND p.user_id=? LEFT JOIN workchat_settings s ON s.workchat_id=w.id WHERE w.id=? AND (w.employer_user_id=? OR p.user_id IS NOT NULL) LIMIT 1`,[userId,userId,id,userId]);
    return rows[0]||null;
  }
  async function canManageWorkchat(chat,userId){
    if(Number(chat.employer_user_id)===Number(userId))return true;
    const [rows]=await db.execute('SELECT 1 FROM workchat_admins WHERE workchat_id=? AND user_id=? LIMIT 1',[chat.id,userId]);
    return rows.length>0;
  }
  app.get('/api/workchats/mine',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;
    const [rows]=await db.execute(`SELECT w.id,w.name,w.status,w.created_at,w.last_message_at,COALESCE(ws.disabled,0) disabled,
      (SELECT COUNT(*) FROM workchat_participants p2 WHERE p2.workchat_id=w.id) participant_count,
      (SELECT COUNT(*) FROM workchat_messages m JOIN workchat_participants me ON me.workchat_id=w.id AND me.user_id=? WHERE m.workchat_id=w.id AND m.sender_id<>? AND m.created_at>COALESCE(me.last_read_at,'1970-01-01')) unread_count,
      (SELECT body FROM workchat_messages m WHERE m.workchat_id=w.id ORDER BY m.id DESC LIMIT 1) last_message
      FROM workchats w LEFT JOIN workchat_settings ws ON ws.workchat_id=w.id
      WHERE w.employer_user_id=? OR EXISTS(SELECT 1 FROM workchat_participants p WHERE p.workchat_id=w.id AND p.user_id=?) ORDER BY COALESCE(w.last_message_at,w.created_at) DESC,w.id DESC`,[req.user.id,req.user.id,req.user.id,req.user.id]);
    const ids=rows.map(x=>Number(x.id));let members={};
    if(ids.length){const [ps]=await db.query(`SELECT p.workchat_id,u.id,u.first_name,u.last_name,u.email,u.role,u.profile_picture FROM workchat_participants p JOIN users u ON u.id=p.user_id WHERE p.workchat_id IN (${ids.map(()=>'?').join(',')}) ORDER BY p.added_at`,ids);
      for(const p of ps)(members[p.workchat_id] ||= []).push({id:Number(p.id),name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.email,email:p.email,role:p.role,profile_picture:p.profile_picture});}
    res.json({workchats:rows.map(w=>({...w,id:Number(w.id),participant_count:Number(w.participant_count||0),unread_count:Number(w.unread_count||0),participants:members[w.id]||[]}))});
  }));
  app.post('/api/workchats',auth,allow('employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const name=String(req.body.name||'').trim();
    const ids=[...new Set((Array.isArray(req.body.participantIds)?req.body.participantIds:[]).map(Number).filter(x=>Number.isInteger(x)&&x>0))];
    if(!name||name.length>100)return res.status(400).json({error:'Workchat name is required (maximum 100 characters).'});
    if(!ids.length)return res.status(400).json({error:'Choose at least one worker to add to this workchat.'});
    const [workers]=await db.query(`SELECT id FROM users WHERE role='worker' AND status='active' AND id IN (${ids.map(()=>'?').join(',')})`,ids);
    if(workers.length!==ids.length)return res.status(400).json({error:'One or more selected workers are unavailable. Refresh the worker list and try again.'});
    const [result]=await db.execute('INSERT INTO workchats(employer_user_id,name) VALUES(?,?)',[req.user.id,name]);const id=Number(result.insertId);
    const pairs=ids.flatMap(workerId=>[id,workerId]);await db.execute('INSERT INTO workchat_participants(workchat_id,user_id) VALUES '+ids.map(()=>'(?,?)').join(','),pairs);
    await db.execute('INSERT IGNORE INTO workchat_participants(workchat_id,user_id) VALUES(?,?)',[id,req.user.id]);
    await audit(req,'workchat.created','workchat',id,{participantCount:ids.length});res.status(201).json({workchatId:id});
  }));
  app.get('/api/workchats/:id/messages',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id);if(!chat)return res.status(404).json({error:'Workchat not found.'});
    await db.execute('UPDATE workchat_participants SET last_read_at=NOW() WHERE workchat_id=? AND user_id=?',[id,req.user.id]);
    const [messages]=await db.execute(`SELECT m.id,m.workchat_id,m.sender_id,m.body,m.created_at,u.first_name sender_first_name,u.last_name sender_last_name,u.role sender_role,u.profile_picture sender_profile_picture FROM workchat_messages m JOIN users u ON u.id=m.sender_id WHERE m.workchat_id=? ORDER BY m.id ASC LIMIT 500`,[id]);
    const [participants]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email,u.role,u.profile_picture FROM workchat_participants p JOIN users u ON u.id=p.user_id WHERE p.workchat_id=? ORDER BY p.added_at`,[id]);
    res.json({workchat:chat,messages,participants:participants.map(p=>({...p,id:Number(p.id),name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.email}))});
  }));
  app.post('/api/workchats/:id/messages',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),body=String(req.body.body||'').trim();if(!body||body.length>5000)return res.status(400).json({error:'Enter a message of 1-5000 characters.'});
    const chat=await getWorkchat(id,req.user.id);if(!chat||chat.status!=='current')return res.status(404).json({error:'This workchat is unavailable.'});if(Number(chat.disabled))return res.status(403).json({error:'Messaging is disabled for this workchat.'});
    const [result]=await db.execute('INSERT INTO workchat_messages(workchat_id,sender_id,body) VALUES(?,?,?)',[id,req.user.id,body]);await db.execute('UPDATE workchats SET last_message_at=NOW() WHERE id=?',[id]);await db.execute('DELETE FROM workchat_typing WHERE workchat_id=? AND user_id=?',[id,req.user.id]);await audit(req,'workchat.message.sent','workchat',id,{messageId:Number(result.insertId)});res.status(201).json({ok:true,id:Number(result.insertId)});
  }));
  app.post('/api/workchats/:id/typing',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id);if(!await getWorkchat(id,req.user.id))return res.status(404).json({error:'Workchat not found.'});
    if(req.body.typing)await db.execute('INSERT INTO workchat_typing(workchat_id,user_id,updated_at) VALUES(?,?,NOW()) ON DUPLICATE KEY UPDATE updated_at=NOW()',[id,req.user.id]);else await db.execute('DELETE FROM workchat_typing WHERE workchat_id=? AND user_id=?',[id,req.user.id]);res.json({ok:true});
  }));
  app.get('/api/workchats/:id/typing',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id);if(!await getWorkchat(id,req.user.id))return res.status(404).json({error:'Workchat not found.'});
    const [rows]=await db.execute(`SELECT t.user_id,u.first_name,u.last_name FROM workchat_typing t JOIN users u ON u.id=t.user_id WHERE t.workchat_id=? AND t.user_id<>? AND t.updated_at>=DATE_SUB(NOW(),INTERVAL 6 SECOND)`,[id,req.user.id]);
    res.json({typing:rows.map(x=>({id:Number(x.user_id),name:[x.first_name,x.last_name].filter(Boolean).join(' ')||'A participant'}))});
  }));
  // "Delete" from the current list archives the conversation into Past workchats,
  // preserving its history for participants to revisit.
  app.delete('/api/workchats/:id',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    await db.execute("UPDATE workchats SET status='past' WHERE id=?",[id]);
    await db.execute('DELETE FROM workchat_typing WHERE workchat_id=?',[id]);
    await audit(req,'workchat.archived','workchat',id,{name:chat.name});
    res.json({ok:true,status:'past'});
  }));
  app.get('/api/workchats/:id/available-participants',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can manage participants.'});
    const q=String(req.query.q||'').trim(),like='%'+q+'%';
    const [rows]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email,u.role FROM users u WHERE u.status='active' AND u.role IN ('worker','employer') AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?) AND NOT EXISTS(SELECT 1 FROM workchat_participants p WHERE p.workchat_id=? AND p.user_id=u.id) ORDER BY u.first_name,u.last_name LIMIT 30`,[like,like,like,id]);
    res.json({participants:rows.map(p=>({...p,id:Number(p.id),name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.email}))});
  }));
  app.post('/api/workchats/:id/participants',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id),userId=Number(req.body.userId);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can manage participants.'});
    const [users]=await db.execute("SELECT id FROM users WHERE id=? AND status='active' AND role IN ('worker','employer')",[userId]);
    if(!users.length)return res.status(404).json({error:'Active participant not found.'});
    await db.execute('INSERT IGNORE INTO workchat_participants(workchat_id,user_id) VALUES(?,?)',[id,userId]);
    if(req.body.isAdmin===true)await db.execute('INSERT IGNORE INTO workchat_admins(workchat_id,user_id) VALUES(?,?)',[id,userId]);
    await audit(req,'workchat.participant.added','workchat',id,{userId,isAdmin:req.body.isAdmin===true});
    res.status(201).json({ok:true});
  }));
  app.patch('/api/workchats/:id/participants/:userId/admin',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),userId=Number(req.params.userId),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can manage participants.'});
    if(Number(chat.employer_user_id)===userId)return res.status(400).json({error:'The employer remains a workchat administrator.'});
    const [members]=await db.execute('SELECT 1 FROM workchat_participants WHERE workchat_id=? AND user_id=?',[id,userId]);
    if(!members.length)return res.status(404).json({error:'Participant not found.'});
    if(req.body.isAdmin===true)await db.execute('INSERT IGNORE INTO workchat_admins(workchat_id,user_id) VALUES(?,?)',[id,userId]);
    else await db.execute('DELETE FROM workchat_admins WHERE workchat_id=? AND user_id=?',[id,userId]);
    res.json({ok:true});
  }));
  app.delete('/api/workchats/:id/participants/:userId',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),userId=Number(req.params.userId),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can manage participants.'});
    if(Number(chat.employer_user_id)===userId)return res.status(400).json({error:'The employer cannot be removed from their workchat.'});
    const [members]=await db.execute('SELECT 1 FROM workchat_participants WHERE workchat_id=? AND user_id=?',[id,userId]);
    if(!members.length)return res.status(404).json({error:'Participant not found.'});
    await db.execute('DELETE FROM workchat_admins WHERE workchat_id=? AND user_id=?',[id,userId]);
    await db.execute('DELETE FROM workchat_participants WHERE workchat_id=? AND user_id=?',[id,userId]);
    await db.execute('DELETE FROM workchat_typing WHERE workchat_id=? AND user_id=?',[id,userId]);
    await audit(req,'workchat.participant.removed','workchat',id,{userId});
    res.json({ok:true});
  }));
  app.patch('/api/workchats/:id/settings',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can change workchat settings.'});
    const disabled=!!req.body.disabled;
    await db.execute('INSERT INTO workchat_settings(workchat_id,disabled) VALUES(?,?) ON DUPLICATE KEY UPDATE disabled=VALUES(disabled)',[id,disabled?1:0]);
    if(disabled)await db.execute('DELETE FROM workchat_typing WHERE workchat_id=?',[id]);
    await audit(req,disabled?'workchat.disabled':'workchat.enabled','workchat',id,{disabled});
    res.json({ok:true,disabled});
  }));
  app.patch('/api/workchats/:id/status',auth,allow('employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const status=req.body.status;if(!['current','past'].includes(status))return res.status(400).json({error:'Choose a valid workchat status.'});
    const [result]=await db.execute('UPDATE workchats SET status=? WHERE id=? AND employer_user_id=?',[status,Number(req.params.id),req.user.id]);if(!result.affectedRows)return res.status(404).json({error:'Workchat not found.'});res.json({ok:true});
  }));

};
