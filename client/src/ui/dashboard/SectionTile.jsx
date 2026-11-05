import React from 'react';
import { Bell, CalendarClock, CalendarDays, CalendarRange, ClipboardCheck, Heart, LifeBuoy, PoundSterling, Receipt, Wallet } from 'lucide-react';

const TILES = {
  employerShifts: [CalendarDays, 'Post, edit and staff your shifts'],
  favourites: [Heart, 'Your go-to people'],
  invoices: [Receipt, 'Bills and payment status'],
  checkouts: [ClipboardCheck, 'Approve hours worked'],
  funds: [Wallet, 'Top-ups and instant pay'],
  notifications: [Bell, 'Alerts and updates'],
  contact: [LifeBuoy, 'Talk to the hyrz team'],
  finances: [PoundSterling, 'Earnings, tax and payslips'],
  availability: [CalendarClock, 'When you can work'],
  timetable: [CalendarRange, 'Your week at a glance']
};

export function SectionTile({ id, label, onClick }) {
  const [Icon, desc] = TILES[id] || [CalendarDays, ''];
  return <button type="button" className="secondary section-tile" onClick={onClick} data-testid={`dashboard-section-${id}`}>
    <span className="section-tile-icon" aria-hidden="true"><Icon size={20} strokeWidth={2} /></span>
    <span className="section-tile-copy"><span className="section-tile-label">{label}</span>{desc && <span className="section-tile-desc">{desc}</span>}</span>
  </button>;
}
