const { auth, allow } = require('./middleware');

module.exports = function registerUserMessageRoutes(app, { db, asyncRoute, audit, addColumn, ensureEmployerWorkerFavourites, ensureProfilePictureColumn, ensureAdminMessageMeta }) {
  const ensureEmployerMessageReadColumn=addColumn('admin_message_meta','employer_read_at DATETIME NULL','employer inbox read state');
  const ensureDirectReadVisibilityColumn=addColumn('employer_worker_messages','read_receipt_visible TINYINT(1) NOT NULL DEFAULT 1','direct message read receipt visibility');
  const ensureLastSeenColumn=addColumn('users','last_seen_at DATETIME NULL','messaging last seen');
  const ensureMessagingPrivacy=db.query(`CREATE TABLE IF NOT EXISTS user_messaging_preferences (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    read_receipts_enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_seen_visibility ENUM('everyone','nobody') NOT NULL DEFAULT 'everyone',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const ensureWorkchatReads=db.query(`CREATE TABLE IF NOT EXISTS workchat_message_reads (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(message_id,user_id),
    KEY idx_workchat_reads_user(user_id,read_at)
  ) ENGINE=InnoDB`);
  async function ensureMessaging(){await Promise.all([ensureLastSeenColumn,ensureMessagingPrivacy,ensureWorkchatReads]);}
  async function getMessagingPreferences(userId){
    await ensureMessaging();
    await db.execute('INSERT IGNORE INTO user_messaging_preferences(user_id) VALUES(?)',[userId]);
    const [rows]=await db.execute('SELECT read_receipts_enabled,last_seen_visibility FROM user_messaging_preferences WHERE user_id=?',[userId]);
    return rows[0]||{read_receipts_enabled:1,last_seen_visibility:'everyone'};
  }
  app.get('/api/messaging/privacy',auth,asyncRoute(async(req,res)=>{
    const p=await getMessagingPreferences(req.user.id);
    res.json({readReceiptsEnabled:Boolean(p.read_receipts_enabled),lastSeenVisibility:p.last_seen_visibility});
  }));
  app.patch('/api/messaging/privacy',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await getMessagingPreferences(req.user.id);
    const readReceiptsEnabled=req.body.readReceiptsEnabled===undefined?undefined:(req.body.readReceiptsEnabled?1:0);
    const lastSeenVisibility=req.body.lastSeenVisibility===undefined?undefined:String(req.body.lastSeenVisibility);
    if(lastSeenVisibility!==undefined&&!['everyone','nobody'].includes(lastSeenVisibility))return res.status(400).json({error:'Choose a valid last-seen visibility.'});
    if(readReceiptsEnabled===undefined&&lastSeenVisibility===undefined)return res.status(400).json({error:'Choose a privacy setting to update.'});
    const updates=[],values=[];
    if(readReceiptsEnabled!==undefined){updates.push('read_receipts_enabled=?');values.push(readReceiptsEnabled);}
    if(lastSeenVisibility!==undefined){updates.push('last_seen_visibility=?');values.push(lastSeenVisibility);}
    values.push(req.user.id);
    await db.execute('UPDATE user_messaging_preferences SET '+updates.join(',')+' WHERE user_id=?',values);
    if(readReceiptsEnabled===0)await db.execute('UPDATE employer_worker_messages m JOIN employer_worker_conversations c ON c.id=m.conversation_id SET m.read_receipt_visible=0 WHERE m.sender_id<>? AND m.read_at IS NOT NULL AND (c.worker_user_id=? OR c.employer_user_id=?)',[req.user.id,req.user.id,req.user.id]);
    const p=await getMessagingPreferences(req.user.id);
    res.json({ok:true,readReceiptsEnabled:Boolean(p.read_receipts_enabled),lastSeenVisibility:p.last_seen_visibility});
  }));
  app.post('/api/messaging/presence',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureMessaging();
    await db.execute('UPDATE users SET last_seen_at=UTC_TIMESTAMP() WHERE id=?',[req.user.id]);
    res.json({ok:true});
  }));
  // Share the API's schema queue so this metadata migration cannot race the
  // user/profile migrations performed during server startup.


  app.post('/api/messages', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    const category=String(req.body.category||'enquiries');
    const subject=String(req.body.subject||'').trim();
    const body=String(req.body.body||'').trim();
    if (!['checkout_disputes','complaints','enquiries'].includes(category)) return res.status(400).json({error:'Choose a valid message subject category'});
    if (subject.length<2||subject.length>200||body.length<1||body.length>5000) return res.status(400).json({error:'Subject must be 2-200 characters and message 1-5000 characters'});
    await ensureAdminMessageMeta;
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
    await ensureAdminMessageMeta;
    const [messages]=await db.execute(`SELECT m.id,m.conversation_key,m.body,m.created_at,m.sender_id,meta.category,meta.subject,meta.read_at,meta.employer_read_at,meta.recipient_id,
      sender.email AS sender_email,sender.role AS sender_role,recipient.email AS recipient_email,recipient.role AS recipient_role
      FROM messages m JOIN admin_message_meta meta ON meta.message_id=m.id
      JOIN users sender ON sender.id=m.sender_id JOIN users recipient ON recipient.id=meta.recipient_id
      WHERE m.sender_id=? OR meta.recipient_id=? ORDER BY m.created_at DESC LIMIT 200`,[req.user.id,req.user.id]);
    res.json({messages});
  }));

  app.post('/api/messages/:id/read', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    await ensureAdminMessageMeta;
    await ensureEmployerMessageReadColumn;
    const [rows]=await db.execute('SELECT m.conversation_key,sender.role AS sender_role FROM messages m JOIN admin_message_meta meta ON meta.message_id=m.id JOIN users sender ON sender.id=m.sender_id WHERE m.id=? AND meta.recipient_id=? AND m.sender_id<>? LIMIT 1',[req.params.id,req.user.id,req.user.id]);
    if(!rows.length)return res.status(404).json({error:'Unread message not found.'});
    if(req.user.role==='worker'){
      if(rows[0].sender_role!=='admin')return res.status(403).json({error:'You can only mark admin messages as read here.'});
      await db.execute("UPDATE admin_message_meta meta JOIN messages m ON m.id=meta.message_id JOIN users sender ON sender.id=m.sender_id SET meta.read_at=COALESCE(meta.read_at,UTC_TIMESTAMP()) WHERE m.conversation_key=? AND meta.recipient_id=? AND sender.role='admin'",[rows[0].conversation_key,req.user.id]);
    }else{
      await db.execute("UPDATE admin_message_meta meta JOIN messages m ON m.id=meta.message_id JOIN users sender ON sender.id=m.sender_id SET meta.employer_read_at=COALESCE(meta.employer_read_at,UTC_TIMESTAMP()) WHERE m.conversation_key=? AND meta.recipient_id=? AND sender.role='admin'",[rows[0].conversation_key,req.user.id]);
    }
    res.json({ok:true,conversationKey:rows[0].conversation_key});
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
      read_receipt_visible TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_direct_messages_conversation (conversation_id,created_at),
      KEY idx_direct_messages_unread (conversation_id,read_at)
    ) ENGINE=InnoDB`)
    ,ensureMessaging(),ensureDirectReadVisibilityColumn
  ]);

  app.get('/api/conversations/mine', auth, allow('worker','employer'), asyncRoute(async(req,res) => {
    await ensureDirectMessages;
    const isEmployer=req.user.role==='employer';
    const ownerColumn=isEmployer?'c.employer_user_id':'c.worker_user_id';
    const [rows]=await db.execute(`
      SELECT c.id,c.employer_user_id,c.worker_user_id,c.created_at,c.last_message_at,
        u.id AS participant_id,u.first_name AS participant_first_name,u.last_name AS participant_last_name,u.email AS participant_email,u.profile_picture AS participant_profile_picture,
        CASE WHEN COALESCE(pref.last_seen_visibility,'everyone')='everyone' THEN u.last_seen_at ELSE NULL END AS participant_last_seen_at,
        (SELECT COUNT(*) FROM employer_worker_messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.read_at IS NULL) AS unread_count,
        (SELECT m.body FROM employer_worker_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message,
        (SELECT m.sender_id FROM employer_worker_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message_sender_id,
        (SELECT m.created_at FROM employer_worker_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message_created_at
      FROM employer_worker_conversations c
      JOIN users u ON u.id=IF(?=1,c.worker_user_id,c.employer_user_id)
      LEFT JOIN user_messaging_preferences pref ON pref.user_id=u.id
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
    const privacy=await getMessagingPreferences(req.user.id);
    await db.execute('UPDATE employer_worker_messages SET read_at=COALESCE(read_at,UTC_TIMESTAMP()),read_receipt_visible=? WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL',[privacy.read_receipts_enabled?1:0,id,req.user.id]);
    const [messages]=await db.execute(`SELECT m.id,m.conversation_id,m.sender_id,m.body,CASE WHEN m.read_receipt_visible=1 THEN m.read_at ELSE NULL END AS read_at,m.created_at,u.first_name AS sender_first_name,u.last_name AS sender_last_name,u.role AS sender_role
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
    db.query(`CREATE TABLE IF NOT EXISTS workchat_messages (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,workchat_id BIGINT UNSIGNED NOT NULL,sender_id BIGINT UNSIGNED NOT NULL,body TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,deleted_at DATETIME NULL,deleted_by BIGINT UNSIGNED NULL,KEY idx_workchat_message(workchat_id,created_at,id)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_typing (workchat_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,updated_at DATETIME NOT NULL,PRIMARY KEY(workchat_id,user_id)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_settings (workchat_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,disabled TINYINT(1) NOT NULL DEFAULT 0,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_admins (workchat_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(workchat_id,user_id)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_pins (message_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,workchat_id BIGINT UNSIGNED NOT NULL,pinned_by BIGINT UNSIGNED NOT NULL,pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,KEY idx_workchat_pins_chat(workchat_id,pinned_at)) ENGINE=InnoDB`),
    db.query(`CREATE TABLE IF NOT EXISTS workchat_message_reactions (message_id BIGINT UNSIGNED NOT NULL,workchat_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,emoji VARCHAR(16) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(message_id,user_id,emoji),KEY idx_workchat_reaction_chat(workchat_id,message_id)) ENGINE=InnoDB`),
  ]);
  let workchatDeletionColumnsReady;
  async function ensureWorkchatMessageDeletionColumns(){
    if(!workchatDeletionColumnsReady)workchatDeletionColumnsReady=(async()=>{
      await ensureGroupWorkchats;
      await addColumn('workchat_messages','deleted_at DATETIME NULL','workchat message deleted_at');
      await addColumn('workchat_messages','deleted_by BIGINT UNSIGNED NULL','workchat message deleted_by');
      await addColumn('workchat_messages','reply_to_message_id BIGINT UNSIGNED NULL','workchat message replies');
    })();
    await workchatDeletionColumnsReady;
  }
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
    await Promise.all([ensureGroupWorkchats,ensureProfilePictureColumn,ensureMessaging()]);
    const [rows]=await db.execute(`SELECT w.id,w.name,w.status,w.created_at,w.last_message_at,COALESCE(ws.disabled,0) disabled,
      (SELECT COUNT(*) FROM workchat_participants p2 WHERE p2.workchat_id=w.id) participant_count,
      (SELECT COUNT(*) FROM workchat_messages m JOIN workchat_participants me ON me.workchat_id=w.id AND me.user_id=? WHERE m.workchat_id=w.id AND m.sender_id<>? AND m.created_at>COALESCE(me.last_read_at,'1970-01-01')) unread_count,
      (SELECT body FROM workchat_messages m WHERE m.workchat_id=w.id ORDER BY m.id DESC LIMIT 1) last_message,
      (SELECT m.sender_id FROM workchat_messages m WHERE m.workchat_id=w.id ORDER BY m.id DESC LIMIT 1) last_message_sender_id,
      (SELECT m.created_at FROM workchat_messages m WHERE m.workchat_id=w.id ORDER BY m.id DESC LIMIT 1) last_message_created_at,
      (SELECT CONCAT_WS(' ',u.first_name,u.last_name) FROM workchat_messages m JOIN users u ON u.id=m.sender_id WHERE m.workchat_id=w.id ORDER BY m.id DESC LIMIT 1) last_message_sender_name
      FROM workchats w LEFT JOIN workchat_settings ws ON ws.workchat_id=w.id
      WHERE w.employer_user_id=? OR EXISTS(SELECT 1 FROM workchat_participants p WHERE p.workchat_id=w.id AND p.user_id=?) ORDER BY COALESCE(w.last_message_at,w.created_at) DESC,w.id DESC`,[req.user.id,req.user.id,req.user.id,req.user.id]);
    const ids=rows.map(x=>Number(x.id));let members={};
    if(ids.length){const [ps]=await db.query(`SELECT p.workchat_id,u.id,u.first_name,u.last_name,u.email,u.role,u.profile_picture,
      CASE WHEN COALESCE(pref.last_seen_visibility,'everyone')='everyone' THEN u.last_seen_at ELSE NULL END AS last_seen_at
      FROM workchat_participants p JOIN users u ON u.id=p.user_id LEFT JOIN user_messaging_preferences pref ON pref.user_id=u.id
      WHERE p.workchat_id IN (${ids.map(()=>'?').join(',')}) ORDER BY p.added_at`,ids);
      for(const p of ps)(members[p.workchat_id] ||= []).push({id:Number(p.id),name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.email,email:p.email,role:p.role,profile_picture:p.profile_picture,last_seen_at:p.last_seen_at});}
    res.json({workchats:rows.map(w=>({...w,id:Number(w.id),participant_count:Number(w.participant_count||0),unread_count:Number(w.unread_count||0),participants:members[w.id]||[]}))});
  }));
  app.post('/api/workchats',auth,allow('employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;await ensureEmployerWorkerFavourites;const name=String(req.body.name||'').trim();
    const ids=[...new Set((Array.isArray(req.body.participantIds)?req.body.participantIds:[]).map(Number).filter(x=>Number.isInteger(x)&&x>0))];
    if(!name||name.length>100)return res.status(400).json({error:'Workchat name is required (maximum 100 characters).'});
    if(!ids.length)return res.status(400).json({error:'Choose at least one worker to add to this workchat.'});
    const [workers]=await db.query(`SELECT id FROM users WHERE role='worker' AND status='active' AND id IN (${ids.map(()=>'?').join(',')})`,ids);
    if(workers.length!==ids.length)return res.status(400).json({error:'One or more selected workers are unavailable. Refresh the worker list and try again.'});
    const [favourites]=await db.query(`SELECT worker_user_id FROM employer_worker_favourites WHERE employer_user_id=? AND worker_user_id IN (${ids.map(()=>'?').join(',')})`,[req.user.id,...ids]);
    if(favourites.length!==ids.length)return res.status(400).json({error:'Only workers on your Favourites list can be added to a workchat. Add the worker to Favourites first.'});
    const [result]=await db.execute('INSERT INTO workchats(employer_user_id,name) VALUES(?,?)',[req.user.id,name]);const id=Number(result.insertId);
    const pairs=ids.flatMap(workerId=>[id,workerId]);await db.execute('INSERT INTO workchat_participants(workchat_id,user_id) VALUES '+ids.map(()=>'(?,?)').join(','),pairs);
    await db.execute('INSERT IGNORE INTO workchat_participants(workchat_id,user_id) VALUES(?,?)',[id,req.user.id]);
    await audit(req,'workchat.created','workchat',id,{participantCount:ids.length});res.status(201).json({workchatId:id});
  }));
  app.get('/api/workchats/:id/messages',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await Promise.all([ensureWorkchatMessageDeletionColumns(),ensureProfilePictureColumn,ensureMessaging()]);
    const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id);if(!chat)return res.status(404).json({error:'Workchat not found.'});
    const privacy=await getMessagingPreferences(req.user.id);
    await db.execute('UPDATE workchat_participants SET last_read_at=UTC_TIMESTAMP() WHERE workchat_id=? AND user_id=?',[id,req.user.id]);
    if(privacy.read_receipts_enabled)await db.execute('INSERT IGNORE INTO workchat_message_reads(message_id,user_id) SELECT id,? FROM workchat_messages WHERE workchat_id=? AND sender_id<>? AND deleted_at IS NULL',[req.user.id,id,req.user.id]);
    const [messages]=await db.execute(`SELECT m.id,m.workchat_id,m.sender_id,m.body,m.created_at,u.first_name sender_first_name,u.last_name sender_last_name,u.role sender_role,u.profile_picture sender_profile_picture,m.deleted_at,m.deleted_by,m.reply_to_message_id,reply.body AS reply_body,reply.deleted_at AS reply_deleted_at,replyUser.first_name AS reply_sender_first_name,replyUser.last_name AS reply_sender_last_name,wp.pinned_at,wp.pinned_by,
      (SELECT COUNT(*) FROM workchat_message_reads mr WHERE mr.message_id=m.id AND mr.user_id<>m.sender_id) AS read_by_count,
      (SELECT COUNT(*) FROM workchat_participants rp WHERE rp.workchat_id=m.workchat_id AND rp.user_id<>m.sender_id) AS recipient_count
      FROM workchat_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN workchat_messages reply ON reply.id=m.reply_to_message_id AND reply.workchat_id=m.workchat_id LEFT JOIN users replyUser ON replyUser.id=reply.sender_id LEFT JOIN workchat_pins wp ON wp.message_id=m.id AND wp.workchat_id=m.workchat_id WHERE m.workchat_id=? ORDER BY m.id ASC`,[id]);
    const [participants]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email,u.role,u.profile_picture,
      CASE WHEN COALESCE(pref.last_seen_visibility,'everyone')='everyone' THEN u.last_seen_at ELSE NULL END AS last_seen_at,
      EXISTS(SELECT 1 FROM workchat_admins wa WHERE wa.workchat_id=p.workchat_id AND wa.user_id=p.user_id) AS is_admin
      FROM workchat_participants p JOIN users u ON u.id=p.user_id JOIN workchats w ON w.id=p.workchat_id
      LEFT JOIN user_messaging_preferences pref ON pref.user_id=u.id
      WHERE p.workchat_id=? ORDER BY CASE WHEN p.user_id=w.employer_user_id THEN 0 WHEN EXISTS(SELECT 1 FROM workchat_admins wa2 WHERE wa2.workchat_id=p.workchat_id AND wa2.user_id=p.user_id) THEN 1 ELSE 2 END, p.added_at, u.first_name, u.last_name`,[id]);
    const [reactionRows]=await db.execute(`SELECT message_id,emoji,COUNT(*) AS count,GROUP_CONCAT(user_id) AS user_ids FROM workchat_message_reactions WHERE workchat_id=? GROUP BY message_id,emoji`,[id]);
    const reactionsByMessage={};for(const row of reactionRows){((reactionsByMessage[row.message_id] ||= [])).push({emoji:row.emoji,count:Number(row.count),reacted_by_me:String(row.user_ids||'').split(',').includes(String(req.user.id))});}
    res.json({workchat:chat,messages:messages.map(m=>({...m,reactions:reactionsByMessage[m.id]||[]})),participants:participants.map(p=>({...p,id:Number(p.id),name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.email}))});
  }));
  app.post('/api/workchats/:id/messages',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),body=String(req.body.body||'').trim();if(!body||body.length>5000)return res.status(400).json({error:'Enter a message of 1-5000 characters.'});
    const chat=await getWorkchat(id,req.user.id);if(!chat||chat.status!=='current')return res.status(404).json({error:'This workchat is unavailable.'});if(Number(chat.disabled))return res.status(403).json({error:'Messaging is disabled for this workchat.'});
    const replyToMessageId=Number(req.body.replyToMessageId)||null;if(replyToMessageId){const [replyRows]=await db.execute('SELECT id FROM workchat_messages WHERE id=? AND workchat_id=?',[replyToMessageId,id]);if(!replyRows.length)return res.status(400).json({error:'The message you are replying to was not found in this workchat.'});}const [result]=await db.execute('INSERT INTO workchat_messages(workchat_id,sender_id,body,reply_to_message_id) VALUES(?,?,?,?)',[id,req.user.id,body,replyToMessageId]);await db.execute('UPDATE workchats SET last_message_at=NOW() WHERE id=?',[id]);await db.execute('DELETE FROM workchat_typing WHERE workchat_id=? AND user_id=?',[id,req.user.id]);await audit(req,'workchat.message.sent','workchat',id,{messageId:Number(result.insertId)});res.status(201).json({ok:true,id:Number(result.insertId)});
  }));
  app.patch('/api/workchats/:id/messages/:messageId',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureWorkchatMessageDeletionColumns();const id=Number(req.params.id),messageId=Number(req.params.messageId),body=String(req.body.body||'').trim(),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    
    if(!body||body.length>5000)return res.status(400).json({error:'Enter a message of 1-5000 characters.'});
    const [messages]=await db.execute('SELECT sender_id,created_at,deleted_at FROM workchat_messages WHERE id=? AND workchat_id=?',[messageId,id]);
    if(!messages.length)return res.status(404).json({error:'Message not found in this workchat.'});
    if(messages[0].deleted_at)return res.status(400).json({error:'Deleted messages cannot be edited.'});
    if(Number(messages[0].sender_id)!==Number(req.user.id))return res.status(403).json({error:'You can only edit your own messages.'});
    if(Date.now()-new Date(messages[0].created_at).getTime()>5*60*1000)return res.status(403).json({error:'Messages can only be edited within 5 minutes of sending.'});
    await db.execute('UPDATE workchat_messages SET body=? WHERE id=? AND workchat_id=?',[body,messageId,id]);
    await audit(req,'workchat.message.edited','workchat',id,{messageId});res.json({ok:true});
  }));
  app.delete('/api/workchats/:id/messages/:messageId',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureWorkchatMessageDeletionColumns();const id=Number(req.params.id),messageId=Number(req.params.messageId),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    
    const [messages]=await db.execute('SELECT id,sender_id,deleted_at FROM workchat_messages WHERE id=? AND workchat_id=?',[messageId,id]);
    if(!messages.length)return res.status(404).json({error:'Message not found in this workchat.'});
    if(messages[0].deleted_at)return res.json({ok:true,alreadyDeleted:true});
    const isWorkchatAdmin=await canManageWorkchat(chat,req.user.id);
    if(Number(messages[0].sender_id)!==Number(req.user.id)&&!isWorkchatAdmin)return res.status(403).json({error:'You can only delete your own messages unless you are a workchat admin.'});
    await db.execute("UPDATE workchat_messages SET body='This message was deleted.',deleted_at=NOW(),deleted_by=? WHERE id=? AND workchat_id=?",[req.user.id,messageId,id]);
    await db.execute('DELETE FROM workchat_pins WHERE message_id=? AND workchat_id=?',[messageId,id]);
    await audit(req,'workchat.message.deleted','workchat',id,{messageId});res.json({ok:true,deleted:true});
  }));
  app.post('/api/workchats/:id/messages/:messageId/reactions',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureWorkchatMessageDeletionColumns();const id=Number(req.params.id),messageId=Number(req.params.messageId),emoji=String(req.body.emoji||'');
    const allowed=['👍','❤️','😂','😮','😢','👏','🎉','🙏','🔥','👎'];
    const chat=await getWorkchat(id,req.user.id);if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!allowed.includes(emoji))return res.status(400).json({error:'Choose a supported reaction.'});
    const [messages]=await db.execute('SELECT id,deleted_at FROM workchat_messages WHERE id=? AND workchat_id=?',[messageId,id]);
    if(!messages.length||messages[0].deleted_at)return res.status(404).json({error:'Message not found.'});
    const [existing]=await db.execute('SELECT 1 FROM workchat_message_reactions WHERE message_id=? AND workchat_id=? AND user_id=? AND emoji=?',[messageId,id,req.user.id,emoji]);
    if(existing.length)await db.execute('DELETE FROM workchat_message_reactions WHERE message_id=? AND workchat_id=? AND user_id=? AND emoji=?',[messageId,id,req.user.id,emoji]);
    else await db.execute('INSERT INTO workchat_message_reactions(message_id,workchat_id,user_id,emoji) VALUES(?,?,?,?)',[messageId,id,req.user.id,emoji]);
    await audit(req,'workchat.message.reaction','workchat',id,{messageId,emoji,removed:!!existing.length});res.json({ok:true});
  }));
  app.post('/api/workchats/:id/messages/:messageId/pin',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureWorkchatMessageDeletionColumns();const id=Number(req.params.id),messageId=Number(req.params.messageId),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can pin messages.'});
    const [messages]=await db.execute('SELECT id,deleted_at FROM workchat_messages WHERE id=? AND workchat_id=?',[messageId,id]);
    if(!messages.length)return res.status(404).json({error:'Message not found in this workchat.'});
    if(messages[0].deleted_at)return res.status(400).json({error:'Deleted messages cannot be pinned.'});
    await db.execute('INSERT INTO workchat_pins(message_id,workchat_id,pinned_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE pinned_by=VALUES(pinned_by),pinned_at=CURRENT_TIMESTAMP',[messageId,id,req.user.id]);
    await audit(req,'workchat.message.pinned','workchat',id,{messageId});res.json({ok:true,pinned:true});
  }));
  app.delete('/api/workchats/:id/messages/:messageId/pin',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;const id=Number(req.params.id),messageId=Number(req.params.messageId),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can unpin messages.'});
    await db.execute('DELETE FROM workchat_pins WHERE message_id=? AND workchat_id=?',[messageId,id]);
    await audit(req,'workchat.message.unpinned','workchat',id,{messageId});res.json({ok:true,pinned:false});
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
    await ensureGroupWorkchats;await ensureEmployerWorkerFavourites;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can manage participants.'});
    const q=String(req.query.q||'').trim(),like='%'+q+'%';
    // The add list is intentionally limited to this employer's favourites.
    // A blank query returns the whole available favourites list; a query filters that same list.
    const [rows]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email,u.role FROM employer_worker_favourites f JOIN users u ON u.id=f.worker_user_id WHERE f.employer_user_id=? AND u.status='active' AND u.role='worker' AND (?='' OR LOWER(CONCAT_WS(' ',u.first_name,u.last_name)) LIKE LOWER(?) OR LOWER(u.email) LIKE LOWER(?)) AND NOT EXISTS(SELECT 1 FROM workchat_participants p WHERE p.workchat_id=? AND p.user_id=u.id) ORDER BY u.first_name,u.last_name LIMIT 1000`,[chat.employer_user_id,q,like,like,id]);
    res.json({participants:rows.map(p=>({...p,id:Number(p.id),name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.email}))});
  }));
  app.post('/api/workchats/:id/participants',auth,allow('worker','employer'),asyncRoute(async(req,res)=>{
    await ensureGroupWorkchats;await ensureEmployerWorkerFavourites;const id=Number(req.params.id),chat=await getWorkchat(id,req.user.id),userId=Number(req.body.userId);
    if(!chat)return res.status(404).json({error:'Workchat not found.'});
    if(!await canManageWorkchat(chat,req.user.id))return res.status(403).json({error:'Only workchat admins can manage participants.'});
    const [users]=await db.execute("SELECT id,role FROM users WHERE id=? AND status='active' AND role IN ('worker','employer')",[userId]);
    if(!users.length)return res.status(404).json({error:'Active participant not found.'});
    if(users[0].role!=='worker')return res.status(400).json({error:'Only workers from your Favourites list can be added to a workchat.'});
    const [favourites]=await db.execute('SELECT 1 FROM employer_worker_favourites WHERE employer_user_id=? AND worker_user_id=? LIMIT 1',[chat.employer_user_id,userId]);
    if(!favourites.length)return res.status(400).json({error:'Only workers on your Favourites list can be added to a workchat. Add the worker to Favourites first.'});
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
    // Any participant can pause/resume messaging; only workchat admins can manage participants.
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
