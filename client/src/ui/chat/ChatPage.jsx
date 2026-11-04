import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Search } from 'lucide-react';
import { request } from '../../api';
import ConversationList from './ConversationList';
import ChatThread from './ChatThread';
import './chat.css';

export default function ChatPage({ user, openApplicationId, onOpened }) {
  const [conversations, setConversations] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  async function loadList() {
    try { const d = await request('/conversations'); setConversations(d.conversations); setError(''); }
    catch (e) { setError(e.message); }
  }

  useEffect(() => {
    loadList();
    const t = setInterval(() => document.visibilityState === 'visible' && loadList(), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!openApplicationId) return;
    request('/conversations', { method: 'POST', body: JSON.stringify({ applicationId: openApplicationId }) })
      .then(d => { setActiveId(d.id); loadList(); })
      .catch(e => setError(e.message))
      .finally(onOpened);
  }, [openApplicationId]);

  const filtered = useMemo(() => (conversations || []).filter(c =>
    `${c.other.name} ${c.shiftTitle} ${c.businessName}`.toLowerCase().includes(query.toLowerCase())), [conversations, query]);
  const active = (conversations || []).find(c => c.id === activeId);

  return (
    <section className={`chat-shell ${active ? 'has-active' : ''}`} data-testid="chat-shell">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-head">
          <h2>Chats</h2>
          <span className="chat-count" data-testid="chat-conversation-count">{conversations?.length || 0}</span>
        </div>
        <label className="chat-search">
          <Search size={16} />
          <input data-testid="chat-search-input" placeholder="Search name or shift" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        {error && <div className="chat-error" data-testid="chat-error">{error}</div>}
        <ConversationList conversations={filtered} loading={!conversations} activeId={activeId} onSelect={setActiveId} />
      </aside>
      {active
        ? <ChatThread key={active.id} conversation={active} user={user} onBack={() => setActiveId(null)} onActivity={loadList} />
        : <div className="chat-empty-state" data-testid="chat-empty-state">
            <div className="chat-empty-icon"><MessageCircle size={40} strokeWidth={1.5} /></div>
            <h3>hyrz messages</h3>
            <p>Talk to {user.role === 'employer' ? 'workers who applied to your shifts' : 'employers about the shifts you applied for'}. Send messages, emoji and GIFs.</p>
            <small>Start a chat from the <b>Applications</b> page with the <b>Message</b> button.</small>
          </div>}
    </section>
  );
}
