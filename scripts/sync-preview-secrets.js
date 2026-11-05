// Preview-only: copies keys saved through the preview secrets store into the hyrz server/client .env files. Not part of the hyrz app.
const fs = require('fs');
const read = f => fs.existsSync(f) ? Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {};
function sync(sources, target, keys) {
  const src = Object.assign({}, ...sources.map(read));
  let text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  let changed = [];
  for (const k of keys) {
    if (!src[k]) continue;
    const line = `${k}=${src[k]}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(text)) { if (!text.match(re)[0].endsWith(src[k])) { text = text.replace(re, line); changed.push(k); } }
    else { text = text.replace(/\n?$/, '\n') + line + '\n'; changed.push(k); }
  }
  if (changed.length) fs.writeFileSync(target, text);
  return changed;
}
const server = sync(['/app/backend/.env'], '/app/server/.env', ['STRIPE_SECRET_KEY', 'STRIPE_IDENTITY_WEBHOOK_SECRET', 'COMPANIES_HOUSE_API_KEY', 'COMPANIES_HOUSE_BASE_URL', 'RESEND_API_KEY', 'EMAIL_FROM']);
const client = sync(['/app/frontend/.env', '/app/backend/.env'], '/app/client/.env', ['VITE_GIPHY_API_KEY']);
console.log(JSON.stringify({ server, client }));
