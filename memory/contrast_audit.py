AUDIT_JS = r"""
async () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = el => { while (el) { const s = getComputedStyle(el); const c = parse(s.backgroundColor); if (s.backgroundImage && s.backgroundImage !== 'none' && !(c && c.a > 0.6)) return null; if (c && c.a > 0.6) return c; el = el.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const out = [];
  const els = [...document.querySelectorAll('button, a, [role=button], .chip, label')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.innerText && e.innerText.trim(); });
  return els.map((e, i) => { e.setAttribute('data-audit', i); return i; });
}
"""
CHECK_JS = r"""
(i) => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = el => { while (el) { const s = getComputedStyle(el); const c = parse(s.backgroundColor); if (c && c.a > 0.6) return c; if (s.backgroundImage && s.backgroundImage !== 'none') return null; el = el.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const e = document.querySelector('[data-audit="' + i + '"]'); if (!e) return null;
  let worst = 99, info = '';
  const nodes = [e, ...e.querySelectorAll('*')].filter(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()));
  for (const n of nodes) { const s = getComputedStyle(n); if (s.visibility === 'hidden' || s.opacity === '0') continue; const fg = parse(s.color); const bg = bgOf(n); if (!fg || !bg) continue; const op = parseFloat(s.opacity); const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const eff = fg.a < 1 || op < 1 ? cr * Math.min(fg.a, op) : cr; if (eff < worst) { worst = eff; info = s.color + ' on ' + JSON.stringify(bg) + ' op=' + s.opacity; } }
  return { cr: Math.round(worst * 100) / 100, info, text: e.innerText.trim().slice(0, 40), cls: (e.className || '').toString().slice(0, 60) };
}
"""

async def audit(page, label):
    ids = await page.evaluate(AUDIT_JS)
    bad = []
    for i in ids[:160]:
        el = page.locator(f'[data-audit="{i}"]')
        try:
            await el.hover(timeout=800, force=True)
            await page.wait_for_timeout(120)
            r = await page.evaluate(CHECK_JS, i)
            if r and r['cr'] < 4.5:
                bad.append(r)
        except Exception:
            pass
    print(f"== {label}: {len(ids)} elements, {len(bad)} low-contrast on hover")
    for b in bad:
        print("  ", b)
