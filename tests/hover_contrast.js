// Contrast helper injected via page.evaluate: returns [ratio, fg, bg, note] for element el
(el) => {
  const parse = s => { const m = s.match(/[\d.]+/g); if (!m) return null; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  // pick the first text-bearing descendant (or el)
  let t = el; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) { if (n.textContent.trim()) { t = n.parentElement; break; } }
  const cs = getComputedStyle(t);
  let fg = parse(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && !/rgba\(0, 0, 0, 0\)/.test(cs.webkitTextFillColor) ? cs.webkitTextFillColor : cs.color);
  let e = t, bg = null, note = '';
  while (e) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) { note = 'bg-image'; }
    const c = parse(s.backgroundColor); if (c && c.a > 0.5) { bg = c; break; } e = e.parentElement; }
  if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
  const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  return [Math.round(ratio * 100) / 100, cs.color, `rgb(${bg.r},${bg.g},${bg.b})`, note, (t.innerText || '').trim().slice(0, 40)];
}
