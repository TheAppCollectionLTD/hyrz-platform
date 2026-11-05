import React, { useMemo, useState } from 'react';
import { ArrowLeft, BellOff, Bell, Camera, ChevronRight, Pencil, Image as ImageIcon, LogOut, Search, Settings2, Trash2, UserPlus, Users } from 'lucide-react';
import './group-info.css';

const MEDIA_RE = /https?:\/\/[^\s<>()]+\.(?:gif|png|jpe?g|webp)(?:\?[^\s<>()]*)?|https?:\/\/media\d*\.giphy\.com\/[^\s<>()]+/gi;
const TONES = ['#2272EB', '#0E9F6E', '#B45309', '#7C3AED', '#0891B2', '#DB2777'];
const fullName = p => p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Participant';
const initials = n => String(n || 'W').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

function Avatar({ name, src, size = 44, tone = 0 }) {
  return <span className="wa-avatar" style={{ width: size, height: size, background: src ? undefined : TONES[tone % TONES.length], fontSize: size * 0.36 }}>{src ? <img src={src} alt="" /> : initials(name)}</span>;
}

function Action({ icon: Icon, label, onClick, testid }) {
  return <button type="button" className="wa-action" onClick={onClick} data-testid={testid}><Icon size={20} /><span>{label}</span></button>;
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new window.Image(), url = URL.createObjectURL(file);
    img.onload = () => { const max = 512, scale = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

export default function WorkchatGroupInfo({ chat, info, participants, messages, currentUserId, disabled, canManage, isOwner, avatar, presence, description = '', onClose, onSearch, onManage, onToggleDisabled, onDelete, onSaveProfile }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(description), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const save = async patch => { setBusy(true); setErr(''); try { await onSaveProfile(patch); setEditing(false); } catch (e) { setErr(e.message || 'Could not save.'); } finally { setBusy(false); } };
  const pickPhoto = async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; if (!/^image\//.test(f.type)) return setErr('Please choose an image file.'); try { await save({ photo: await resizeImage(f) }); } catch (x) { setErr(x.message); } };
  const [query, setQuery] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const name = info?.name || chat?.name || 'Workchat';
  const media = useMemo(() => messages.filter(m => !m.deleted_at).flatMap(m => (String(m.body || '').match(MEDIA_RE) || []).map(url => ({ id: `${m.id}-${url}`, url }))).reverse(), [messages]);
  const links = useMemo(() => messages.filter(m => !m.deleted_at).flatMap(m => (String(m.body || '').match(/https?:\/\/[^\s<>()]+/g) || []).filter(u => !u.match(MEDIA_RE)).map(url => ({ id: `${m.id}-${url}`, url }))), [messages]);
  const sorted = [...participants].sort((a, b) => (Number(b.id) === Number(currentUserId)) - (Number(a.id) === Number(currentUserId)) || Number(Boolean(Number(b.is_admin))) - Number(Boolean(Number(a.is_admin))) || fullName(a).localeCompare(fullName(b)));
  const shown = sorted.filter(p => fullName(p).toLowerCase().includes(query.trim().toLowerCase()));
  const creator = [info?.created_by_first_name, info?.created_by_last_name].filter(Boolean).join(' ') || info?.created_by_email;
  const created = info?.created_at ? new Date(info.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return <section className="wa-info" data-testid="workchat-group-info" aria-label="Group info">
    <header className="wa-info-bar"><button type="button" className="wa-icon-btn" onClick={onClose} aria-label="Back to chat" data-testid="group-info-back"><ArrowLeft size={22} /></button><strong>Group info</strong></header>
    <div className="wa-info-scroll">
      <div className="wa-card wa-hero">
        <div className="wa-photo-wrap"><Avatar name={name} src={avatar} size={112} />{canManage && <label className="wa-photo-edit" title="Change group photo" data-testid="group-info-photo-edit"><Camera size={18} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} disabled={busy} data-testid="group-info-photo-input" /></label>}</div>
        <h2 data-testid="group-info-name">{name}</h2>
        <p>Group · {participants.length} member{participants.length === 1 ? '' : 's'}</p>
        <div className="wa-actions">
          <Action icon={Search} label="Search" onClick={onSearch} testid="group-info-search" />
          {canManage && <Action icon={UserPlus} label="Add" onClick={onManage} testid="group-info-add" />}
          {canManage && <Action icon={disabled ? Bell : BellOff} label={disabled ? 'Unlock' : 'Lock chat'} onClick={onToggleDisabled} testid="group-info-lock" />}
        </div>
      </div>

      <div className="wa-card wa-about" data-testid="group-info-about">
        {err && <p className="wa-err" data-testid="group-info-error">{err}</p>}
        {editing ? <div className="wa-desc-edit"><textarea value={draft} maxLength={500} rows={3} onChange={e => setDraft(e.target.value)} placeholder="Add a group description, e.g. meeting point, dress code, rota link" data-testid="group-info-description-input" autoFocus /><div><small>{draft.length}/500</small><button type="button" className="wa-text-btn" onClick={() => { setEditing(false); setDraft(description); }}>Cancel</button><button type="button" className="wa-save-btn" disabled={busy} onClick={() => save({ description: draft })} data-testid="group-info-description-save">{busy ? 'Saving…' : 'Save'}</button></div></div>
          : <div className="wa-desc"><p className={description ? 'wa-desc-text' : 'wa-desc-empty'} data-testid="group-info-description">{description || (canManage ? 'Add group description' : 'No group description yet')}</p>{canManage && <button type="button" className="wa-icon-btn wa-pencil" onClick={() => { setDraft(description); setEditing(true); }} aria-label="Edit description" data-testid="group-info-description-edit"><Pencil size={16} /></button>}</div>}
        <p className="wa-about-text">{disabled ? 'Only admins can send messages right now.' : 'Everyone in this group can send messages.'}</p>
        <small>{creator ? `Created by ${creator}` : 'Workchat'}{created ? `, ${created}` : ''}</small>
      </div>

      <div className="wa-card">
        <div className="wa-row-head"><span>Media, links and GIFs</span><small>{media.length + links.length}<ChevronRight size={16} /></small></div>
        {media.length ? <div className="wa-media-strip" data-testid="group-info-media">{media.slice(0, 12).map(item => <button type="button" key={item.id} className="wa-media" onClick={() => setLightbox(item.url)}><img src={item.url} alt="" loading="lazy" /></button>)}</div>
          : <p className="wa-empty"><ImageIcon size={18} /> No photos or GIFs shared yet</p>}
        {links.slice(0, 3).map(l => <a key={l.id} className="wa-link" href={l.url} target="_blank" rel="noreferrer">{l.url}</a>)}
      </div>

      <div className="wa-card wa-members" data-testid="group-info-members">
        <div className="wa-row-head"><span><Users size={16} /> {participants.length} members</span>{participants.length > 6 && <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members" data-testid="group-info-member-search" />}</div>
        {canManage && <button type="button" className="wa-member wa-add" onClick={onManage} data-testid="group-info-add-row"><span className="wa-avatar wa-add-icon"><UserPlus size={20} /></span><span className="wa-member-copy"><strong>Add or manage members</strong></span></button>}
        {shown.map((p, i) => {
          const me = Number(p.id) === Number(currentUserId);
          return <div className="wa-member" key={p.id} data-testid={`group-info-member-${p.id}`}>
            <Avatar name={fullName(p)} src={p.profile_picture} tone={i + 1} />
            <span className="wa-member-copy"><strong>{me ? 'You' : fullName(p)}</strong><small>{p.last_seen_at ? presence(p.last_seen_at) : p.role === 'employer' ? 'Employer' : 'Worker'}</small></span>
            {Boolean(Number(p.is_admin)) && <b className="wa-admin">Group admin</b>}
          </div>;
        })}
        {info?.past_participants?.length > 0 && <p className="wa-past">Past members: {info.past_participants.map(p => p.name || p.email).join(', ')}</p>}
      </div>

      <div className="wa-card wa-danger">
        {canManage && <button type="button" onClick={onManage} data-testid="group-info-settings"><Settings2 size={20} /> Group settings</button>}
        {isOwner ? <button type="button" className="red" onClick={onDelete} data-testid="group-info-delete"><Trash2 size={20} /> Delete group</button>
          : <button type="button" className="red" onClick={onClose} disabled title="Ask the employer to remove you" data-testid="group-info-exit"><LogOut size={20} /> Exit group (ask the employer)</button>}
      </div>
    </div>
    {lightbox && <div className="wa-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Media preview" data-testid="group-info-lightbox"><img src={lightbox} alt="" /></div>}
  </section>;
}
