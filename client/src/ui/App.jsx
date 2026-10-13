import React,{useEffect,useState}from'react';import{request,token}from'../api';
const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n||0));
export default function App(){
 const [user,setUser]=useState(null),[page,setPage]=useState('home'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[onboarding,setOnboarding]=useState(null),[onboardingLoading,setOnboardingLoading]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[role,setRole]=useState('worker'),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[businessName,setBusinessName]=useState(''),[companyRole,setCompanyRole]=useState(''),[companyNumber,setCompanyNumber]=useState('');
 const [shifts,setShifts]=useState([]),[applications,setApplications]=useState([]),[checkouts,setCheckouts]=useState([]),[invoices,setInvoices]=useState([]),[overview,setOverview]=useState(null),[search,setSearch]=useState(''),[verificationAccounts,setVerificationAccounts]=useState([]);
 const [shift,setShift]=useState({title:'',description:'',location:'',startsAt:'',endsAt:'',hourlyPay:'15',breakMinutes:0,slots:1});
 async function load(){
   if(!token())return;
   setOnboardingLoading(true);
   try {
     const m=await request('/auth/me');
     setUser(m.user);
     const statusResponse=await request('/onboarding/status');
     const status=statusResponse.onboarding;
     setOnboarding(status);
     if(!status.canAccessPlatform && m.user.role!=='admin'){
       setShifts([]);setApplications([]);setCheckouts([]);setInvoices([]);
       return;
     }
     const [s,a,c,i]=await Promise.all([
       request('/shifts'),request('/applications/mine'),
       request('/checkouts/mine'),request('/invoices/mine')
     ]);
     setShifts(s.shifts);setApplications(a.applications);
     setCheckouts(c.checkouts);setInvoices(i.invoices);
     if(m.user.role==='admin'){const o=await request('/admin/overview');setOverview(o);const q=await request('/admin/verification-queue');setVerificationAccounts(q.accounts||[]);}
   } catch(e) {
     setError(e.message);
   } finally {
     setOnboardingLoading(false);
   }
 }

 useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const verificationToken = params.get('verify-email');

  if (verificationToken) {
    setPage('verifying');

    request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verificationToken })
    })
      .then((data) => {
        setNotice(data.message || 'Email verified successfully. You can now log in.');
        setPage('verified');
      })
      .catch((err) => {
        setError(err.message || 'This verification link is invalid or expired.');
        setPage('verifyError');
      })
      .finally(() => {
        window.history.replaceState({}, '', window.location.pathname);
      });

    return;
  }

  load();
}, []);

 async function action(fn){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message)}finally{setBusy(false)}}
 
async function authenticate(register) {
  if (register && password !== confirmPassword) {
    setError('Your passwords do not match. Please try again.');
    return;
  }

  await action(async () => {
    const d = await request(register ? '/auth/register' : '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        confirmPassword,
        role,
        firstName,
        lastName,
        businessName,
        companyRole,
        companyNumber
      })
    });

    if (register) {
      setNotice('Your account has been created. Check your inbox to verify your email.');
      setPage('checkEmail');
      return;
    }

    localStorage.setItem('hyrz_token', d.token);
    setUser(d.user);
    setNotice('Signed in');
    await load();
    setPage('dashboard');
  });
}

 async function createShift(e){e.preventDefault();await action(async()=>{await request('/shifts',{method:'POST',body:JSON.stringify(shift)});setNotice('Shift published');await load()})}
 async function apply(id){await action(async()=>{await request(`/shifts/${id}/apply`,{method:'POST',body:'{}'});setNotice('Application submitted');await load()})}
 async function updateApplication(id,status){await action(async()=>{await request(`/applications/${id}`,{method:'PATCH',body:JSON.stringify({status})});await load()})}
 async function reviewVerification(account,check,status){const reason=window.prompt(`Reason for setting ${check.replace('_',' ')} to ${status} for ${account.email}:`);if(reason===null)return;if(reason.trim().length<3){setError('Please enter a reason of at least 3 characters.');return;}await action(async()=>{await request(`/admin/verification/${account.role}/${account.userId}`,{method:'PATCH',body:JSON.stringify({check,status,reason:reason.trim()})});setNotice('Verification status updated and recorded.');await load();})}
 async function logout(){localStorage.removeItem('hyrz_token');setUser(null);setPage('home')}
 const visibleShifts=shifts.filter(s=>`${s.title} ${s.location} ${s.business_name}`.toLowerCase().includes(search.toLowerCase()));
 return <div className={`${user?.role==='worker'?'app worker':'app'} ${!user&&['home','register','login','chooseRole'].includes(page)?'auth-layout':''}`}><aside className="sidebar"><a className="brand" onClick={()=>setPage('home')}>hyrz</a><p className="tag">Flexible Work.<br/>Reliable Staffing.</p>{user&&(onboarding?.canAccessPlatform||user.role==='admin')&&<nav>{[['dashboard','Overview'],['jobs','Find shifts'],['applications','Applications'],['checkouts','Checkouts'],['invoices','Invoices'],...(user.role==='employer'?[['post','Post a shift']]:[]),...(user.role==='admin'?[['admin','Administration']]:[])].map(([id,label])=><button key={id} className={page===id?'selected':''} onClick={()=>setPage(id)}>{label}</button>)}</nav>}<div className="sidebottom"><small className="company-trademark">@TheAppCollectionLTD</small>{user?<><small>{user.email}</small><button onClick={logout}>Sign out</button></>:<button onClick={()=>setPage('login')}>Sign in</button>}</div></aside>
 <main><header><div><span className="eyebrow">UK FLEXIBLE STAFFING</span><h1>{!user?'Find work that works for you':page==='jobs'?'Find shifts':page==='post'?'Publish a shift':page==='admin'?'Admin overview':page[0].toUpperCase()+page.slice(1)}</h1></div>{user&&<div className="userpill">{user.first_name||user.role} · {user.role}</div>}</header>
 {error&&<div className="alert error">{error}</div>}{notice&&<div className="alert success">{notice}</div>}
 {user&&user.role!=='admin'&&(!onboarding||!onboarding.canAccessPlatform)&&<section className="panel onboarding-panel">
    <span className="eyebrow">ACCOUNT VERIFICATION</span>
    <h2>{onboardingLoading?'Checking your verification status':'Complete your hyrz verification'}</h2>
    <p className="onboarding-intro">To protect workers and employers, access to restricted hyrz features stays locked until the required checks have been approved. Your email verification is separate from identity and eligibility checks.</p>
    {!onboardingLoading&&!onboarding&&<p>We couldn't retrieve your verification status. Refresh to try again.</p>}
    {onboarding&&<>
      <div className="verification-list">
        <VerificationRow title="Email address" status={onboarding.emailVerified?'verified':'pending'} detail={onboarding.emailVerified?'Your email address is verified.':'Verify your email address before continuing.'}/>
        <VerificationRow title="Identity check" status={onboarding.identityStatus} detail={verificationDetail(onboarding.identityStatus,'identity')}/>
        {user.role==='worker'
          ? <VerificationRow title="Right-to-work check" status={onboarding.rightToWorkStatus} detail={verificationDetail(onboarding.rightToWorkStatus,'right-to-work')}/>
          : <VerificationRow title="Company verification" status={onboarding.companyStatus} detail={verificationDetail(onboarding.companyStatus,'company')}/>}
      </div>
      <div className="onboarding-notice"><strong>What happens next?</strong><p>Submitting information alone does not approve a check. hyrz must receive a trusted verification result or an authorised review decision. The online verification submission flow is not connected yet, so do not enter or upload sensitive identity documents here.</p></div>
    </>}
    <div className="onboarding-actions">
      <button className="primary" disabled={onboardingLoading} onClick={()=>action(async()=>{const result=await request('/onboarding/status');setOnboarding(result.onboarding);setNotice('Verification status refreshed.');})}>Refresh status</button>
      <button className="secondary" onClick={logout}>Sign out</button>
    </div>
  </section>}
 {!user&&page==='home'&&<section className="auth-welcome">
<div className="work-carousel">
  <div className="carousel-slide slide-hospitality">
    <span className="pill">HOSPITALITY & BARS</span>
    <h2>Pick up a shift.<br/><em>Make it count.</em></h2>
    <p>Flexible bar, restaurant and hospitality work to fit your availability.</p>
  </div>
  <div className="carousel-slide slide-festivals">
    <span className="pill">FESTIVALS & EVENTS</span>
    <h2>Be part of<br/><em>what's happening.</em></h2>
    <p>Discover event and festival shifts, from front-of-house to event support.</p>
  </div>
  <div className="carousel-slide slide-warehouse">
    <span className="pill">WAREHOUSE & LOGISTICS</span>
    <h2>Extra hours.<br/><em>Extra earning power.</em></h2>
    <p>Explore warehouse, fulfilment and logistics shifts that suit your schedule.</p>
  </div>
  <div className="carousel-slide slide-office">
    <span className="pill">OFFICE & ADMINISTRATION</span>
    <h2>Put your skills<br/><em>to work.</em></h2>
    <p>Find office and administration opportunities across different industries.</p>
  </div>
  <div className="carousel-slide slide-retail">
    <span className="pill">RETAIL & CUSTOMER SERVICE</span>
    <h2>Find shifts<br/><em>that fit your day.</em></h2>
    <p>Choose from available retail and customer service opportunities.</p>
  </div>
  <div className="carousel-slide slide-hotels">
    <span className="pill">HOTELS & CATERING</span>
    <h2>Flexible work.<br/><em>More possibilities.</em></h2>
    <p>Explore hotel, catering and service shifts around your other commitments.</p>
  </div>
  <div className="carousel-slide slide-more">
    <span className="pill">MORE OPPORTUNITIES</span>
    <h2>Find work that<br/><em>fits you.</em></h2>
    <p>From hospitality and logistics to office work, retail and beyond, discover opportunities that suit your availability.</p>
  </div>
</div>
<div className="welcome-panel"><div className="brand-mark">hyrz</div>
<h2>Work around your life.<br/><em>Not vice versa.</em></h2>
<p>Explore jobs, choose shifts that suit your availability and earn on your terms.</p>
<button className="primary" onClick={()=>setPage('chooseRole')}>Get started</button>
<p>Already registered? <button className="textbutton" onClick={()=>setPage('login')}>Sign in</button></p>
</div></section>}
{!user&&page==='home'&&<section className="how-hyrz-works">
  <div className="how-heading">
    <span className="eyebrow">FLEXIBILITY, MADE SIMPLE</span>
    <h2>Work that works around you.</h2>
    <p>Finding shifts should fit into your life, not take it over.</p>
  </div>
  <div className="how-steps">
    <article className="how-step">
      <span className="step-number">01</span>
      <h3>Choose your availability</h3>
      <p>Decide which days and times work around your existing commitments.</p>
    </article>
    <article className="how-step">
      <span className="step-number">02</span>
      <h3>Explore suitable shifts</h3>
      <p>Browse opportunities across different industries and working environments.</p>
    </article>
    <article className="how-step">
      <span className="step-number">03</span>
      <h3>Work on your terms</h3>
      <p>Apply for available shifts that fit your schedule and preferences.</p>
    </article>
  </div>
  <button className="primary how-cta" onClick={()=>setPage('chooseRole')}>Get started ↗</button>
</section>}
 {!user&&page==='chooseRole'&&<section className="role-selection">
<button className="textbutton" onClick={()=>setPage('home')}>← Back</button>
<h2>How will you use hyrz?</h2><p>Choose your account type.</p>
<div className="role-cards">
<button className="role-card" onClick={()=>{setRole('worker');setPage('register')}}><strong>I'm looking for work</strong><span>Find flexible shifts and manage applications.</span><b>Continue as a worker →</b></button>
<button className="role-card" onClick={()=>{setRole('employer');setPage('register')}}><strong>I'm an employer</strong><span>Find workers and manage your staffing.</span><b>Continue as an employer →</b></button>
</div></section>}
{!user&&page==='login'&&<section className="panel auth">
<button className="textbutton" onClick={()=>setPage('home')}>← Back to home</button>
<h2>Welcome back</h2><p>Sign in to your hyrz account.</p>
<form onSubmit={e=>{e.preventDefault();authenticate(false)}}>
<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
<label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
<button className="primary" disabled={busy}>Sign in</button></form>
</section>}

{!user && page === 'checkEmail' && (
  <section className="panel auth">
    <h2>Check your email</h2>
    <p>Your hyrz account has been created. We've sent a verification link to:</p>
    <p><strong>{email}</strong></p>
    <p>Open the email and follow the link to verify your address. The link expires after 30 minutes.</p>
    <button
      className="primary"
      disabled={busy}
      onClick={() => action(async () => {
        const result = await request('/auth/resend-verification', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        setNotice(result.message);
      })}
    >
      Resend verification email
    </button>
    <button className="secondary" onClick={() => setPage('login')}>
      Back to sign in
    </button>
  </section>
)}

{!user && page === 'verifying' && (
  <section className="panel auth">
    <h2>Verifying your email…</h2>
    <p>Please wait while we confirm your email address.</p>
  </section>
)}

{!user && page === 'verified' && (
  <section className="panel auth">
    <h2>Email verified!</h2>
    <p>Your email address is confirmed. You can now sign in to hyrz.</p>
    <button className="primary" onClick={() => setPage('login')}>
      Sign in
    </button>
  </section>
)}

{!user && page === 'verifyError' && (
  <section className="panel auth">
    <h2>Verification link unavailable</h2>
    <p>{error || 'This link may have expired or already been used.'}</p>
    <label>
      Email address
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
    </label>
    <button
      className="primary"
      disabled={busy}
      onClick={() => action(async () => {
        const result = await request('/auth/resend-verification', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        setNotice(result.message);
        setError('');
      })}
    >
      Request another verification email
    </button>
    <button className="secondary" onClick={() => setPage('login')}>
      Back to sign in
    </button>
  </section>
)}

{!user&&page==='register'&&<section className="panel auth"><button type="button" className="textbutton" onClick={()=>setPage("chooseRole")}>← Change account type</button><h2>{role==="worker"?"Create your worker account":"Create your employer account"}</h2><p>Join hyrz and get started.</p><form onSubmit={e=>{e.preventDefault();authenticate(true)}}><label>Account type<select value={role} onChange={e=>setRole(e.target.value)}><option value="worker">Worker</option><option value="employer">Employer</option></select></label><div className="grid2"><label>First name<input value={firstName} onChange={e=>setFirstName(e.target.value)}/></label><label>Last name<input value={lastName} onChange={e=>setLastName(e.target.value)}/></label></div>{role==='employer'&&<><label>Business name<input required value={businessName} onChange={e=>setBusinessName(e.target.value)}/></label><label>Your role at the company<input required value={companyRole} onChange={e=>setCompanyRole(e.target.value)} placeholder="e.g. Owner, HR Manager, Recruiter"/></label><label>Company registration number (if applicable)<input value={companyNumber} onChange={e=>setCompanyNumber(e.target.value)} placeholder="Companies House number, if applicable"/><small>Leave blank if your organisation does not have a company registration number.</small></label></>}<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password (12+ characters)<input type="password" minLength="12" required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" minLength="12" required autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></label><button className="primary" disabled={busy}>Create account</button></form></section>}
 
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='dashboard'&&<><section className="stats"><div className="stat"><small>OPEN SHIFTS</small><strong>{shifts.length}</strong></div><div className="stat"><small>APPLICATIONS</small><strong>{applications.length}</strong></div><div className="stat"><small>CHECKOUTS</small><strong>{checkouts.length}</strong></div><div className="stat"><small>INVOICES</small><strong>{invoices.length}</strong></div></section><section className="panel"><div className="panel-head"><div><span className="eyebrow">LATEST OPPORTUNITIES</span><h2>Shifts you can explore</h2></div><button className="secondary" onClick={()=>setPage('jobs')}>View all ↗</button></div><ShiftList shifts={visibleShifts.slice(0,4)} role={user.role} apply={apply}/></section></>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='jobs'&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">OPPORTUNITIES</span><h2>Find your next shift</h2></div><input className="search" placeholder="Search role or location" value={search} onChange={e=>setSearch(e.target.value)}/></div><ShiftList shifts={visibleShifts} role={user.role} apply={apply}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='post'&&user.role==='employer'&&<section className="panel"><h2>Shift details</h2><form onSubmit={createShift} className="formgrid">{[['title','Role / title'],['location','Location'],['startsAt','Start date and time'],['endsAt','End date and time'],['hourlyPay','Hourly pay (£)'],['slots','Number of workers'],['breakMinutes','Unpaid break (minutes)']].map(([k,l])=><label key={k}>{l}<input required type={['startsAt','endsAt'].includes(k)?'datetime-local':k==='title'||k==='location'?'text':'number'} min={['hourlyPay','slots','breakMinutes'].includes(k)?'0':undefined} step={k==='hourlyPay'?'0.01':undefined} value={shift[k]} onChange={e=>setShift({...shift,[k]:e.target.value})}/></label>)}<label className="wide">Description<textarea value={shift.description} onChange={e=>setShift({...shift,description:e.target.value})}/></label><button className="primary">Publish shift</button></form></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='applications'&&<section className="panel"><h2>Applications</h2><DataList items={applications} empty="No applications yet." render={a=><div className="row" key={a.id}><div><b>{a.title}</b><small>{a.business_name||`${a.first_name||''} ${a.last_name||''}`} · {a.starts_at}</small></div><span className={`status ${a.status}`}>{a.status}</span>{user.role==='employer'&&a.status==='pending'&&<div className="actions"><button onClick={()=>updateApplication(a.id,'approved')}>Approve</button><button onClick={()=>updateApplication(a.id,'rejected')}>Reject</button></div>}</div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='checkouts'&&<section className="panel"><h2>Timesheets & checkouts</h2><DataList items={checkouts} empty="No checkouts yet." render={c=><div className="row" key={c.id}><div><b>{c.title||`Checkout #${c.id}`}</b><small>{c.actual_start} – {c.actual_end} · Gross {money(c.gross_pay)} · Fee {money(c.platform_fee)}</small></div><span className={`status ${c.status}`}>{c.status}</span>{['employer','admin'].includes(user.role)&&c.status==='submitted'&&<button onClick={()=>action(async()=>{await request(`/checkouts/${c.id}/review`,{method:'PATCH',body:JSON.stringify({status:'approved'})});await load()})}>Approve</button>}</div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='invoices'&&<section className="panel"><h2>Invoices</h2><DataList items={invoices} empty="No invoices yet." render={i=><div className="row" key={i.id}><div><b>Invoice #{i.id} · {i.title}</b><small>Due {i.due_at} · Platform fee {money(i.platform_fee)}</small></div><strong>{money(i.total)}</strong><span className={`status ${i.status}`}>{i.status}</span></div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='admin'&&user.role==='admin'&&<><section className="stats">{Object.entries(overview||{}).map(([k,v])=><div className="stat" key={k}><small>{k.replace(/([A-Z])/g,' $1').toUpperCase()}</small><strong>{v}</strong></div>)}</section><section className="panel"><div className="panel-head"><div><span className="eyebrow">MANUAL REVIEW</span><h2>Verification queue</h2></div><button className="secondary" onClick={()=>action(load)}>Refresh queue</button></div><p>For controlled testing only. Review evidence using your approved process; do not approve a real person's identity or right to work based on unverified claims or test data.</p><DataList items={verificationAccounts} empty="No accounts found." render={account=><article className="review-account" key={`${account.role}-${account.userId}`}><div className="review-account-head"><div><strong>{account.firstName||''} {account.lastName||''}</strong><small>{account.email} · {account.role} · Email {account.emailVerified?'verified':'not verified'}</small>{account.role==='employer'&&<small>{account.businessName||'Business name unavailable'}{account.companyNumber?` · Company no. ${account.companyNumber}`:''}</small>}</div><small>Created {account.createdAt?new Date(account.createdAt).toLocaleDateString('en-GB'):'—'}</small></div><div className="review-checks"><ReviewControl title="Identity" status={account.identityStatus} onChoose={status=>reviewVerification(account,'identity',status)}/>{account.role==='worker'?<ReviewControl title="Right to work" status={account.rightToWorkStatus} onChoose={status=>reviewVerification(account,'right_to_work',status)}/>:<ReviewControl title="Company" status={account.companyStatus} onChoose={status=>reviewVerification(account,'company',status)}/>}</div></article>}/></section></>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='dashboard'&&user.role==='employer'&&<section className="panel"><div className="panel-head"><h2>Employer quick actions</h2><button className="primary" onClick={()=>setPage('post')}>+ Publish a shift</button></div><p>Publish shifts, review applicants, and approve completed checkouts from your dashboard.</p></section>}
 <footer><span>hyrz</span><span>Flexible Work. Reliable Staffing.</span><span>@TheAppCollectionLTD</span></footer>
 </main></div>
}
function ShiftList({shifts,role,apply}){return <DataList items={shifts} empty="No open shifts found." render={s=><div className="shiftrow" key={s.id}><div className="shiftdate">{new Date(s.starts_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</div><div className="shiftmain"><b>{s.title}</b><small>{s.business_name} · {s.location}</small><small>{new Date(s.starts_at).toLocaleString('en-GB')} – {new Date(s.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</small></div><div className="shiftpay"><strong>{money(s.hourly_pay)}<small>/hr</small></strong>{role==='worker'&&<button onClick={()=>apply(s.id)}>Apply ↗</button>}</div></div>}/>}
function DataList({items,empty,render}){return items?.length? <div className="list">{items.map(render)}</div>:<div className="empty">{empty}</div>}

function verificationDetail(status, kind) {
  if (status === 'verified') return `Your ${kind} check is approved.`;
  if (status === 'pending') return `Your ${kind} check is awaiting review.`;
  if (status === 'manual_review') return `Your ${kind} check requires a manual review.`;
  if (status === 'rejected') return `Your ${kind} check was not approved. Follow the instructions from the review team.`;
  return `Your ${kind} check has not been completed.`;
}
function VerificationRow({title,status,detail}) {
  const normalized = ['not_started','pending','verified','rejected','manual_review'].includes(status) ? status : 'not_started';
  const label = normalized === 'not_started' ? 'Not started' : normalized.replace('_',' ');
  return <article className="verification-row">
    <div className="verification-copy"><strong>{title}</strong><p>{detail}</p></div>
    <span className={`verification-status ${normalized}`}>{label}</span>
  </article>;
}

function ReviewControl({title,status,onChoose}){const current=status||'not_started';return <div className="review-control"><div><strong>{title}</strong><span className={`verification-status ${current}`}>{current.replace('_',' ')}</span></div><div className="review-actions">{['pending','manual_review','verified','rejected'].map(next=><button key={next} type="button" className={next===current?'selected-review':''} onClick={()=>onChoose(next)} disabled={next===current}>{next.replace('_',' ')}</button>)}</div></div>}
