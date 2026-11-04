const express = require('express');
const db = require('./db');
const { auth, requireVerification } = require('./middleware');

const router = express.Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const GIF_HOST = /^https:\/\/([a-z0-9-]+\.)*giphy\.com\//i;
const MAX_BODY = 4000;

router.use(auth, requireVerification);

async function membership(conversationId, userId) {
  const [rows] = await db.execute(
    `SELECT c.*, s.title AS shift_title FROM conversations c JOIN shifts s ON s.id=c.shift_id
     WHERE c.id=? AND (c.worker_id=? OR c.employer_id=?)`, [conversationId, userId, userId]);
  return rows[0] || null;
}

const preview = m => m.deleted_at ? 'This message was deleted' : m.kind === 'gif' ? 'GIF' : m.body;

router.get('/conversations', asyncRoute(async (req, res) => {
  const me = req.user.id;
  const [rows] = await db.execute(
    `SELECT c.id, c.application_id, c.worker_id, c.employer_id, s.title AS shift_title,
            UNIX_TIMESTAMP(s.starts_at)*1000 AS shift_starts_at, b.name AS business_name, a.status AS application_status,
            o.id AS other_id, o.first_name AS other_first, o.last_name AS other_last, o.role AS other_role,
            UNIX_TIMESTAMP(COALESCE(c.last_message_at,c.created_at))*1000 AS activity_at,
            lm.id AS lm_id, lm.kind AS lm_kind, lm.body AS lm_body, lm.sender_id AS lm_sender, lm.deleted_at AS lm_deleted,
            mine.last_read_message_id AS my_read, theirs.last_read_message_id AS their_read,
            (SELECT COUNT(*) FROM chat_messages x WHERE x.conversation_id=c.id AND x.sender_id<>? AND x.id>mine.last_read_message_id) AS unread,
            (theirs.typing_until IS NOT NULL AND theirs.typing_until>UTC_TIMESTAMP()) AS other_typing
     FROM conversations c
     JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id
     JOIN applications a ON a.id=c.application_id
     JOIN users o ON o.id = IF(c.worker_id=?, c.employer_id, c.worker_id)
     JOIN conversation_members mine ON mine.conversation_id=c.id AND mine.user_id=?
     LEFT JOIN conversation_members theirs ON theirs.conversation_id=c.id AND theirs.user_id=o.id
     LEFT JOIN chat_messages lm ON lm.id=(SELECT MAX(id) FROM chat_messages WHERE conversation_id=c.id)
     WHERE c.worker_id=? OR c.employer_id=?
     ORDER BY activity_at DESC LIMIT 200`, [me, me, me, me, me]);
  res.json({
    conversations: rows.map(r => ({
      id: r.id, applicationId: r.application_id, shiftTitle: r.shift_title, shiftStartsAt: Number(r.shift_starts_at),
      businessName: r.business_name, applicationStatus: r.application_status,
      other: { id: r.other_id, name: `${r.other_first || ''} ${r.other_last || ''}`.trim() || 'hyrz user', role: r.other_role },
      activityAt: Number(r.activity_at), unread: Number(r.unread), otherTyping: Boolean(r.other_typing),
      lastMessage: r.lm_id ? { id: r.lm_id, kind: r.lm_kind, text: preview({ kind: r.lm_kind, body: r.lm_body, deleted_at: r.lm_deleted }),
        mine: r.lm_sender === me, read: Number(r.their_read || 0) >= r.lm_id } : null
    }))
  });
}));

router.get('/conversations/unread-count', asyncRoute(async (req, res) => {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) AS n FROM chat_messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
     WHERE m.sender_id<>? AND m.id>cm.last_read_message_id`, [req.user.id, req.user.id]);
  res.json({ unread: Number(row.n) });
}));

router.post('/conversations', asyncRoute(async (req, res) => {
  const applicationId = Number(req.body.applicationId);
  if (!Number.isInteger(applicationId) || applicationId < 1) return res.status(400).json({ error: 'Application required' });
  const [apps] = await db.execute(
    `SELECT a.id, a.shift_id, a.worker_id, b.owner_user_id FROM applications a JOIN shifts s ON s.id=a.shift_id
     JOIN businesses b ON b.id=s.business_id WHERE a.id=?`, [applicationId]);
  const app = apps[0];
  if (!app || (app.worker_id !== req.user.id && app.owner_user_id !== req.user.id)) return res.status(404).json({ error: 'Application not found' });
  await db.execute('INSERT IGNORE INTO conversations(application_id,shift_id,worker_id,employer_id) VALUES(?,?,?,?)',
    [app.id, app.shift_id, app.worker_id, app.owner_user_id]);
  const [[conv]] = await db.execute('SELECT id FROM conversations WHERE application_id=?', [app.id]);
  await db.execute('INSERT IGNORE INTO conversation_members(conversation_id,user_id) VALUES(?,?),(?,?)',
    [conv.id, app.worker_id, conv.id, app.owner_user_id]);
  res.status(201).json({ id: conv.id });
}));

router.get('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const me = req.user.id;
  const conv = await membership(req.params.id, me);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const otherId = conv.worker_id === me ? conv.employer_id : conv.worker_id;
  const [rows] = await db.execute(
    `SELECT * FROM (SELECT m.id, m.sender_id, m.kind, m.body, m.gif_url, m.gif_preview_url, m.gif_title, m.deleted_at,
            UNIX_TIMESTAMP(m.created_at)*1000 AS created_at, r.id AS r_id, r.sender_id AS r_sender, r.kind AS r_kind, r.body AS r_body, r.deleted_at AS r_deleted
       FROM chat_messages m LEFT JOIN chat_messages r ON r.id=m.reply_to_id
       WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 300) t ORDER BY id ASC`, [conv.id]);
  const ids = rows.map(r => r.id);
  const [reactions] = ids.length
    ? await db.query('SELECT message_id, user_id, emoji FROM chat_message_reactions WHERE message_id IN (?)', [ids])
    : [[]];
  const [members] = await db.execute(
    'SELECT user_id, last_read_message_id, (typing_until IS NOT NULL AND typing_until>UTC_TIMESTAMP()) AS typing FROM conversation_members WHERE conversation_id=?', [conv.id]);
  const other = members.find(m => m.user_id === otherId) || {};
  res.json({
    otherLastRead: Number(other.last_read_message_id || 0),
    otherTyping: Boolean(other.typing),
    messages: rows.map(m => ({
      id: m.id, senderId: m.sender_id, mine: m.sender_id === me, kind: m.kind, deleted: Boolean(m.deleted_at),
      body: m.deleted_at ? null : m.body, gifUrl: m.deleted_at ? null : m.gif_url,
      gifPreviewUrl: m.deleted_at ? null : m.gif_preview_url, gifTitle: m.gif_title, createdAt: Number(m.created_at),
      replyTo: m.r_id ? { id: m.r_id, mine: m.r_sender === me, text: preview({ kind: m.r_kind, body: m.r_body, deleted_at: m.r_deleted }) } : null,
      reactions: reactions.filter(r => r.message_id === m.id).map(r => ({ emoji: r.emoji, mine: r.user_id === me }))
    }))
  });
}));

router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const conv = await membership(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const { kind = 'text', body, gifUrl, gifPreviewUrl, gifTitle, replyToId } = req.body || {};
  let text = null;
  if (kind === 'text') {
    text = typeof body === 'string' ? body.trim() : '';
    if (!text || text.length > MAX_BODY) return res.status(400).json({ error: `Message must be 1-${MAX_BODY} characters` });
  } else if (kind === 'gif') {
    if (!GIF_HOST.test(gifUrl || '') || (gifPreviewUrl && !GIF_HOST.test(gifPreviewUrl))) return res.status(400).json({ error: 'Invalid GIF' });
  } else return res.status(400).json({ error: 'Invalid message type' });
  let reply = null;
  if (replyToId) {
    const [r] = await db.execute('SELECT id FROM chat_messages WHERE id=? AND conversation_id=?', [replyToId, conv.id]);
    if (!r.length) return res.status(400).json({ error: 'Reply target not found' });
    reply = r[0].id;
  }
  const [r] = await db.execute(
    'INSERT INTO chat_messages(conversation_id,sender_id,kind,body,gif_url,gif_preview_url,gif_title,reply_to_id) VALUES(?,?,?,?,?,?,?,?)',
    [conv.id, req.user.id, kind, text, kind === 'gif' ? gifUrl : null, kind === 'gif' ? (gifPreviewUrl || gifUrl) : null,
      kind === 'gif' ? String(gifTitle || '').slice(0, 255) || null : null, reply]);
  await db.execute('UPDATE conversations SET last_message_at=CURRENT_TIMESTAMP WHERE id=?', [conv.id]);
  await db.execute('UPDATE conversation_members SET last_read_message_id=?, typing_until=NULL WHERE conversation_id=? AND user_id=?', [r.insertId, conv.id, req.user.id]);
  res.status(201).json({ id: r.insertId });
}));

router.post('/conversations/:id/read', asyncRoute(async (req, res) => {
  const conv = await membership(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  await db.execute(
    `UPDATE conversation_members SET last_read_message_id=GREATEST(last_read_message_id,
       (SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE conversation_id=?)) WHERE conversation_id=? AND user_id=?`,
    [conv.id, conv.id, req.user.id]);
  res.json({ ok: true });
}));

router.post('/conversations/:id/typing', asyncRoute(async (req, res) => {
  const conv = await membership(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  await db.execute('UPDATE conversation_members SET typing_until=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 SECOND) WHERE conversation_id=? AND user_id=?', [conv.id, req.user.id]);
  res.json({ ok: true });
}));

async function ownMessage(messageId, userId) {
  const [rows] = await db.execute(
    `SELECT m.id, m.sender_id, m.conversation_id FROM chat_messages m JOIN conversations c ON c.id=m.conversation_id
     WHERE m.id=? AND (c.worker_id=? OR c.employer_id=?)`, [messageId, userId, userId]);
  return rows[0] || null;
}

router.put('/chat-messages/:id/reaction', asyncRoute(async (req, res) => {
  const msg = await ownMessage(req.params.id, req.user.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const emoji = req.body?.emoji;
  if (!emoji) {
    await db.execute('DELETE FROM chat_message_reactions WHERE message_id=? AND user_id=?', [msg.id, req.user.id]);
    return res.json({ ok: true });
  }
  if (typeof emoji !== 'string' || emoji.length > 16 || /[\w\s<>]/.test(emoji)) return res.status(400).json({ error: 'Invalid reaction' });
  await db.execute('INSERT INTO chat_message_reactions(message_id,user_id,emoji) VALUES(?,?,?) ON DUPLICATE KEY UPDATE emoji=VALUES(emoji)', [msg.id, req.user.id, emoji]);
  res.json({ ok: true });
}));

router.delete('/chat-messages/:id', asyncRoute(async (req, res) => {
  const msg = await ownMessage(req.params.id, req.user.id);
  if (!msg || msg.sender_id !== req.user.id) return res.status(404).json({ error: 'Message not found' });
  await db.execute('UPDATE chat_messages SET deleted_at=UTC_TIMESTAMP(), body=NULL, gif_url=NULL, gif_preview_url=NULL WHERE id=?', [msg.id]);
  res.json({ ok: true });
}));

module.exports = router;
