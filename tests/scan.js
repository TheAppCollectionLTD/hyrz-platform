()=>{function p(c){const m=c.match(/[\d.]+/g);return m?m.map(Number):null}
function lum([r,g,b]){const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)}
function bg(el){while(el){const c=p(getComputedStyle(el).backgroundColor);if(c&&(c.length<4||c[3]>0.5))return c;el=el.parentElement}return[255,255,255]}
function pink(c){const[r,g,b]=c;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx-mn<40)return false;let h;if(mx===r)h=((g-b)/(mx-mn))*60;else if(mx===g)h=(2+(b-r)/(mx-mn))*60;else h=(4+(r-g)/(mx-mn))*60;if(h<0)h+=360;return (h>=300||h<=12)&&r>100}
const out=[];const seen=new Set();
for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.opacity==='0')continue;
const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('').slice(0,40);
const b=bg(el);
if(txt){const fc=p(cs.webkitTextFillColor||cs.color)||p(cs.color);const l1=lum(fc),l2=lum(b);const cr=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);if(cr<2.6){const k='LOW '+txt;if(!seen.has(k)){seen.add(k);out.push(`LOW ${cr.toFixed(2)} "${txt}" <${el.tagName.toLowerCase()}.${String(el.className).slice(0,40)}> fg=${cs.color} bg=${b}`)}}
 if(pink(fc)){out.push(`PINKTEXT "${txt}" <${el.tagName.toLowerCase()}.${String(el.className).slice(0,40)}> ${cs.color}`)}}
const ob=p(cs.backgroundColor);if(ob&&(ob.length<4||ob[3]>0.5)&&pink(ob)){out.push(`PINKBG <${el.tagName.toLowerCase()}.${String(el.className).slice(0,40)}> ${cs.backgroundColor} "${(el.innerText||'').slice(0,20)}"`)}
const bc=p(cs.borderLeftColor);if(parseFloat(cs.borderLeftWidth)>0&&bc&&pink(bc))out.push(`PINKBORDER <${el.tagName.toLowerCase()}.${String(el.className).slice(0,40)}> ${cs.borderLeftColor}`)}
return out.slice(0,60)}
