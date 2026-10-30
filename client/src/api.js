const configuredApiUrl = import.meta.env.VITE_API_URL;
function defaultApiUrl() {
 if (typeof window === 'undefined') return 'http://localhost:4001/api';
 const hostname = window.location.hostname;
 const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
 // A physical Expo Go device must reach the computer over the LAN, not its own localhost.
 if (!isLoopback && hostname) return `http://${hostname}:4001/api`;
 return 'http://localhost:4001/api';
}
const API = configuredApiUrl || defaultApiUrl();
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
