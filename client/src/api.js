const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export function token(){return localStorage.getItem('hyrz_token');}
export async function request(path, options={}) {
 const res=await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`} : {}),...(options.headers||{})}});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error(data.error||`Request failed (${res.status})`);
 return data;
}
