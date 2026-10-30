const configuredApiUrl = import.meta.env.VITE_API_URL;
function resolveApiUrl() {
 if (typeof window === 'undefined') return configuredApiUrl || 'http://localhost:4000/api';
 const pageHost = window.location.hostname;
 const pageIsLoopback = pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1';
 if (configuredApiUrl) {
  try {
   const configured = new URL(configuredApiUrl);
   const apiIsLoopback = configured.hostname === 'localhost' || configured.hostname === '127.0.0.1' || configured.hostname === '::1';
   // A LAN-loaded Expo WebView cannot use the computer's localhost alias.
   // Preserve the configured API port/path but substitute the Vite host.
   if (!pageIsLoopback && apiIsLoopback) configured.hostname = pageHost;
   return configured.toString().replace(/\\/$/, '');
  } catch { return configuredApiUrl; }
 }
 // Standard local API runs on 4000; the isolated test API uses .env.test (4001).
 return `http://${pageHost || 'localhost'}:4000/api`;
}
const API = resolveApiUrl();
export function token(){return localStorage.getItem('hyrz_token');}
export async function request(path, options={}) {
 let res;
 try {
  res = await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`} : {}),...(options.headers||{})}});
 } catch (error) {
  const host = (()=>{try{return new URL(API).host}catch{return API}})();
  throw new Error(`Cannot reach the Hyrz server at ${host}. On Expo Go, make sure your phone and computer are on the same Wi-Fi and that the API server is running.`);
 }
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error(data.error||`Request failed (${res.status})`);
 return data;
}
