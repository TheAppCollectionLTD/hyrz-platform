import React,{useEffect,useState}from'react';import{request,token}from'../api';
const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n||0));
export default function App(){
 const [user,setUser]=useState(null),[page,setPage]=useState('home'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[onboarding,setOnboarding]=useState(null),[onboardingLoading,setOnboardingLoading]=useState(false);
 const [pageHistory,setPageHistory]=useState([]);
 const mainWorkerPages=['dashboard','jobs','contact','account','workchats','employerInbox','employerShifts','favourites','invoices','checkouts','funds'];
 function navigateTo(next){setPageHistory(previous=>page===next?previous:[...previous,page]);setPage(next);}
 function goBack(){const previous=[...pageHistory];while(previous.length){const candidate=previous.pop();if(mainWorkerPages.includes(candidate)){setPageHistory(previous);setPage(candidate);return;}}setPageHistory([]);setPage(user?.role==='employer'?'workchats':'jobs');}
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[role,setRole]=useState('worker'),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[businessName,setBusinessName]=useState(''),[companyRole,setCompanyRole]=useState(''),[companyNumber,setCompanyNumber]=useState(''),[businessAddress,setBusinessAddress]=useState(''),[businessCity,setBusinessCity]=useState(''),[businessPostcode,setBusinessPostcode]=useState(''),[nationalInsuranceNumber,setNationalInsuranceNumber]=useState(''),[workerPermitNumber,setWorkerPermitNumber]=useState('');
 const [shifts,setShifts]=useState([]),[applications,setApplications]=useState([]),[checkouts,setCheckouts]=useState([]),[invoices,setInvoices]=useState([]),[overview,setOverview]=useState(null),[search,setSearch]=useState(''),[selectedShiftDate,setSelectedShiftDate]=useState(''),[shiftTypeFilter,setShiftTypeFilter]=useState('all'),[minHourlyRate,setMinHourlyRate]=useState(''),[maxHourlyRate,setMaxHourlyRate]=useState(''),[maxDistance,setMaxDistance]=useState(''),[roleFilter,setRoleFilter]=useState('all'),[showShiftFilters,setShowShiftFilters]=useState(false),[verificationAccounts,setVerificationAccounts]=useState([]),[jobFilter,setJobFilter]=useState('available');
 const [shift,setShift]=useState({title:'',description:'',location:'',startsAt:'',endsAt:'',hourlyPay:'15',breakMinutes:0,slots:1});
 async function load(){
   if(!token())return;
   setOnboardingLoading(true);
   try {
     const m=await request('/auth/me');
     setUser(m.user);
     // Restore the correct signed-in landing page on refresh as well as after login.
     if (page==='home' || page==='login') setPage(m.user.role==='admin'?'admin':m.user.role==='worker'?'jobs':'workchats');
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
    navigateTo('verifying');

    request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verificationToken })
    })
      .then((data) => {
        setNotice(data.message || 'Email verified successfully. You can now log in.');
        navigateTo('verified');
      })
      .catch((err) => {
        setError(err.message || 'This verification link is invalid or expired.');
        navigateTo('verifyError');
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
  if (register && role==='worker' && !nationalInsuranceNumber.trim() && !workerPermitNumber.trim()) { setError('Enter your National Insurance number or worker permit number so hyrz can prevent blocked-account re-registration.'); return; }
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
        companyNumber,
        businessAddress: role==='employer' ? businessAddress.trim() : undefined,
        businessCity: role==='employer' ? businessCity.trim() : undefined,
        postcode: role==='employer' ? businessPostcode.trim() : undefined,
        nationalInsuranceNumber: register && role==='worker' ? nationalInsuranceNumber.trim() : undefined,
        workerPermitNumber: register && role==='worker' ? workerPermitNumber.trim() : undefined
      })
    });

    if (register) {
      setNotice('Your account has been created. Check your inbox to verify your email.');
      navigateTo('checkEmail');
      return;
    }

    localStorage.setItem('hyrz_token', d.token);
    setUser(d.user);
    setNotice('Signed in');
    await load();
    setPageHistory([]);setPage(d.user?.role==='admin'?'admin':d.user?.role==='worker'?'jobs':'workchats');
  });
}

 async function createShift(e){e.preventDefault();await action(async()=>{await request('/shifts',{method:'POST',body:JSON.stringify(shift)});setNotice('Shift published');await load()})}
 async function apply(id){await action(async()=>{await request(`/shifts/${id}/apply`,{method:'POST',body:'{}'});setNotice('Application submitted');await load()})}
 async function updateApplication(id,status){await action(async()=>{await request(`/applications/${id}`,{method:'PATCH',body:JSON.stringify({status})});await load()})}
 async function reviewVerification(account,check,status){const reason=window.prompt(`Reason for setting ${check.replace('_',' ')} to ${status} for ${account.email}:`);if(reason===null)return;if(reason.trim().length<3){setError('Please enter a reason of at least 3 characters.');return;}await action(async()=>{await request(`/admin/verification/${account.role}/${account.userId}`,{method:'PATCH',body:JSON.stringify({check,status,reason:reason.trim()})});setNotice('Verification status updated and recorded.');await load();})}
 async function logout(){localStorage.removeItem('hyrz_token');setUser(null);navigateTo('home')}
 const shiftRoles=[...new Set(shifts.map(s=>String(s.title||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); const visibleShifts=shifts.filter(s=>{const matchesText=`${s.title} ${s.location} ${s.business_name}`.toLowerCase().includes(search.toLowerCase());const date=String(s.starts_at||'').slice(0,10);const hourly=Number(s.hourly_pay||0);const distance=maxDistance===''||Number(s.distance_miles??0)<=Number(maxDistance);return matchesText&&(shiftTypeFilter==='all'||String(s.title||'').toLowerCase().includes(shiftTypeFilter))&&(roleFilter==='all'||s.title===roleFilter)&&(minHourlyRate===''||hourly>=Number(minHourlyRate))&&(maxHourlyRate===''||hourly<=Number(maxHourlyRate))&&distance;});
 return <div className={`${user?.role==='worker'?'app worker':user?.role==='employer'?'app employer':'app'} ${!user&&['home','register','login','chooseRole'].includes(page)?'auth-layout':''}`}><aside className="sidebar"><a className="brand" onClick={()=>navigateTo('home')}>hyrz</a>{!user&&<p className="tag">Flexible Work.<br/>Reliable Staffing.</p>}{user&&user.role!=='employer'&&<nav>{(user.role==='admin'?[['admin','Dashboard'],['account','My account']]:[['dashboard','Dashboard'],['account','My account']]).map(([id,label])=><button key={id} className={page===id?'selected':''} onClick={()=>navigateTo(id)}>{label}</button>)}</nav>}<div className="sidebottom">{user?<button onClick={logout}>Sign out</button>:<button onClick={()=>navigateTo('login')}>Sign in</button>}</div></aside>
 <main><header className={user?.role==='worker'?'worker-page-header':''}><div>{user?.role==='worker'&&page==='dashboard'&&<span className="eyebrow">YOUR PERSONAL WORKSPACE</span>}{user?.role==='employer'&&<span className="eyebrow">EMPLOYER WORKSPACE</span>}{!user&&<span className="eyebrow">UK FLEXIBLE STAFFING</span>}{user?.role==='worker'&&page==='dashboard'?<h1>Hello, {user.first_name||'there'}</h1>:<h1>{!user?'Find work that works for you':page==='account'?`Hello, ${user.first_name||'there'}` :page==='jobs'?'Find shifts':page==='post'?'Publish a shift':page==='admin'?'Dashboard':page==='workchats'&&user?.role==='employer'?'Workchat':page==='employerInbox'?'Inbox':page==='employerShifts'?'Shifts':page[0].toUpperCase()+page.slice(1)}</h1>}{user?.role==='worker'&&page==='dashboard'&&<p className="worker-greeting-subtitle">Your shifts, messages and work preferences — all in one place.</p>}</div>{user?.role==='worker'&&<button className="secondary worker-signout" onClick={logout}>Sign out</button>}{user?.role==='employer'&&<button className="secondary employer-signout" onClick={logout}>Sign out</button>}</header>{user&&['worker','employer'].includes(user.role)&&!['dashboard','jobs','contact','account','workchats'].includes(page)&&<div className="worker-subsection-toolbar"><button type="button" className="worker-back-button" onClick={goBack}>← Back</button></div>}
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
<button className="primary" onClick={()=>navigateTo('chooseRole')}>Get started</button>
<p>Already registered? <button className="textbutton" onClick={()=>navigateTo('login')}>Sign in</button></p>
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
  <button className="primary how-cta" onClick={()=>navigateTo('chooseRole')}>Get started ↗</button>
</section>}
 {!user&&page==='chooseRole'&&<section className="role-selection">
<button className="textbutton" onClick={()=>navigateTo('home')}>← Back</button>
<h2>How will you use hyrz?</h2><p>Choose your account type.</p>
<div className="role-cards">
<button className="role-card" onClick={()=>{setRole('worker');navigateTo('register')}}><strong>I'm looking for work</strong><span>Find flexible shifts and manage applications.</span><b>Continue as a worker →</b></button>
<button className="role-card" onClick={()=>{setRole('employer');navigateTo('register')}}><strong>I'm an employer</strong><span>Find workers and manage your staffing.</span><b>Continue as an employer →</b></button>
</div></section>}
{!user&&page==='login'&&<section className="panel auth">
<button className="textbutton" onClick={()=>navigateTo('home')}>← Back to home</button>
<h2>Welcome back</h2><p>Sign in to your hyrz account.</p>
<form onSubmit={e=>{e.preventDefault();authenticate(false)}}>
<label>Email<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
<label>Password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
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
    <button className="secondary" onClick={() => navigateTo('login')}>
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
    <button className="primary" onClick={() => navigateTo('login')}>
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
    <button className="secondary" onClick={() => navigateTo('login')}>
      Back to sign in
    </button>
  </section>
)}

{!user&&page==='register'&&<section className="panel auth"><button type="button" className="textbutton" onClick={()=>navigateTo("chooseRole")}>← Change account type</button><h2>{role==="worker"?"Create your worker account":"Create your employer account"}</h2><p>Join hyrz and get started.</p><form onSubmit={e=>{e.preventDefault();authenticate(true)}}><label>Account type<select value={role} onChange={e=>setRole(e.target.value)}><option value="worker">Worker</option><option value="employer">Employer</option></select></label><div className="grid2"><label>First name<input value={firstName} onChange={e=>setFirstName(e.target.value)}/></label><label>Last name<input value={lastName} onChange={e=>setLastName(e.target.value)}/></label></div>{role==='employer'&&<><label>Business name<input required value={businessName} onChange={e=>setBusinessName(e.target.value)}/></label><label>Business address<input required autoComplete="street-address" value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} placeholder="Street address and building number"/></label><div className="grid2"><label>Town or city<input required autoComplete="address-level2" value={businessCity} onChange={e=>setBusinessCity(e.target.value)}/></label><label>Postcode<input required autoComplete="postal-code" value={businessPostcode} onChange={e=>setBusinessPostcode(e.target.value.toUpperCase())}/></label></div><label>Your role at the company<input required value={companyRole} onChange={e=>setCompanyRole(e.target.value)} placeholder="e.g. Owner, HR Manager, Recruiter"/></label><label>Company registration number (if applicable)<input value={companyNumber} onChange={e=>setCompanyNumber(e.target.value)} placeholder="Companies House number, if applicable"/><small>Leave blank if your organisation does not have a company registration number.</small></label><p className="muted">For your security, bank details will be collected through a verified payment-provider onboarding flow, not stored directly in this form. Company verification will remain pending until a trusted verification result is connected.</p></>}{role==='worker'&&<><label>National Insurance number<input value={nationalInsuranceNumber} onChange={e=>setNationalInsuranceNumber(e.target.value)} autoComplete="off"/><small>Enter this or a worker permit number. hyrz stores a one-way hash for blocked-account checks, not the original number.</small></label><label>Worker permit number (if applicable)<input value={workerPermitNumber} onChange={e=>setWorkerPermitNumber(e.target.value)} autoComplete="off"/></label></>}<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password (12+ characters)<input type="password" minLength="12" required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" minLength="12" required autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></label><button className="primary" disabled={busy}>Create account</button></form></section>}
 

 {user?.role==='employer'&&page==='workchats'&&<section className="employer-welcome">
   <div className="employer-hero"><span className="eyebrow">YOUR TEAM, IN ONE PLACE</span><h2>Good work starts with<br/><em>good people.</em></h2><p>Keep conversations with your favourite workers together, coordinate upcoming shifts and build a team you can rely on.</p><button className="primary" onClick={()=>navigateTo('dashboard')}>Open employer dashboard ↗</button></div>
   <div className="employer-workchat-card"><div className="employer-chat-icon">↗</div><span className="eyebrow">WORKCHAT</span><h3>Your favourite workers</h3><p>Group chats with favourited workers will appear here when messaging is connected.</p><div className="empty-state">No workchats yet</div><button className="secondary" onClick={()=>navigateTo('favourites')}>Manage favourites</button></div>
 </section>}
 {user?.role==='employer'&&page==='dashboard'&&<section className="employer-dashboard">
   <div className="employer-dashboard-intro"><div><span className="eyebrow">YOUR BUSINESS AT A GLANCE</span><h2>Manage your workforce</h2><p>Post shifts, review applicants and keep track of completed work and payments.</p></div><button className="primary" onClick={()=>navigateTo('post')}>+ Post a shift</button></div>
   <div className="employer-shortcuts">{[['employerShifts','Shifts','Post shifts and review applicants','↗'],['favourites','Favourites','Build your trusted team','☆'],['invoices','Invoices','Review invoices for completed work','£'],['checkouts','Checkouts','Approve submitted timesheets','✓'],['funds','Funds','Manage your staffing balance','＋'],['employerInbox','Inbox','Messages from workers and hyrz','✉']].map(([id,title,desc,icon])=><button className="employer-shortcut" key={id} onClick={()=>navigateTo(id)}><span className="employer-shortcut-icon">{icon}</span><strong>{title}</strong><small>{desc}</small><b>Open section →</b></button>)}</div>
   <div className="employer-note"><strong>Built around your workflow</strong><p>Shift publishing, applications, checkouts and invoices use the existing connected flows where available. Favourites, prepaid funds, automated applicant rules and employer/worker inbox separation still need their dedicated backend workflows before they can be used operationally.</p></div>
 </section>}
 {user?.role==='employer'&&page==='employerShifts'&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">PLAN YOUR WORKFORCE</span><h2>Shifts and applicants</h2><p>Create shifts or review people who have applied.</p></div><button className="primary" onClick={()=>navigateTo('post')}>+ Post a shift</button></div><div className="employer-section-actions"><button className="secondary" onClick={()=>navigateTo('applications')}>Review applicants</button><button className="secondary" onClick={()=>navigateTo('post')}>Create a shift</button></div><ShiftList shifts={shifts.filter(s=>Number(s.employer_id)===Number(user.id)||Number(s.created_by)===Number(user.id))} role={user.role} apply={apply}/><p className="muted">Calendar copying across multiple dates, six-week scheduling, applicant ratings/experience filters and automatic approval criteria are not connected yet.</p></section>}
 {user?.role==='employer'&&page==='favourites'&&<section className="panel"><span className="eyebrow">YOUR TRUSTED TEAM</span><h2>Favourite workers</h2><p>Keep the workers you trust close and make it easier to invite them to future shifts.</p><div className="empty-state">Your favourite workers will appear here.</div><p className="muted">Worker search, add/remove favourites, past-shift shortcuts and favourite-based auto-approval are not connected yet.</p></section>}
 {user?.role==='employer'&&page==='funds'&&<section className="panel"><span className="eyebrow">STAFFING BALANCE</span><h2>Funds</h2><p>Keep track of the funds you intend to use for upcoming shifts.</p><div className="employer-funds-summary"><small>AVAILABLE BALANCE</small><strong>£0.00</strong><p>No funds account is connected yet.</p></div><button className="primary" disabled>Add funds (coming next)</button><p className="muted">Deposits, committed balances, refunds and cancellation charges must be implemented and tested before funds can be added or held.</p></section>}
 {user?.role==='employer'&&page==='employerInbox'&&<section className="panel"><span className="eyebrow">MESSAGES</span><h2>Inbox</h2><p>Keep worker conversations and hyrz admin support in one place.</p><div className="employer-section-actions"><button className="secondary" onClick={()=>navigateTo('contact')}>Contact hyrz support</button></div><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/><p className="muted">Employer/worker conversation filters and email alerts for every new inbox message still need their dedicated messaging workflow.</p></section>}
 {user?.role==='employer'&&page==='contact'&&<section className="panel employer-contact"><span className="eyebrow">WE'RE HERE TO HELP</span><h2>Contact hyrz</h2><p>Send the support team an enquiry, complaint or checkout dispute. Your message is recorded in the support messaging system.</p><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/><p className="muted">Published admin phone and email contact details will be added once the official support contact details are configured.</p></section>}

 {user?.role==='worker'&&page==='dashboard'&&<section className="worker-section-nav panel"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Dashboard sections</h2></div><div className="worker-section-links">{[['inbox','Inbox'],['checkouts','Checkouts'],['invoices','Invoices'],['availability','Availability'],['favourites','Favourites'],['complaints','Complaints'],['timetable','Timetable'],['notifications','Notifications']].map(([id,label])=><button key={id} className="secondary" onClick={()=>navigateTo(id)}>{label}</button>)}</div></section>}
 {user&&user.role==='worker'&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='dashboard'&&<><section className="stats"><div className="stat"><small>OPEN SHIFTS</small><strong>{shifts.length}</strong></div><div className="stat"><small>APPLICATIONS</small><strong>{applications.length}</strong></div><div className="stat"><small>CHECKOUTS</small><strong>{checkouts.length}</strong></div><div className="stat"><small>INVOICES</small><strong>{invoices.length}</strong></div></section><section className="panel"><div className="panel-head"><div><span className="eyebrow">LATEST OPPORTUNITIES</span><h2>Shifts you can explore</h2></div><button className="secondary" onClick={()=>navigateTo('jobs')}>View all ↗</button></div><ShiftList shifts={visibleShifts.slice(0,4)} role={user.role} apply={apply}/></section></>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='jobs'&&<section className="panel find-shifts-panel"><div className="find-shifts-heading"><div><span className="eyebrow">OPPORTUNITIES</span><h2>Find your next shift</h2><p>Select a date to see available shifts starting that day.</p></div></div><div className="rolling-shift-calendar"><div className="rolling-calendar-heading"><div><strong>Next 6 weeks</strong><span>Select a day to see available shifts</span></div><button type="button" className="calendar-clear" onClick={()=>setSelectedShiftDate('')} disabled={!selectedShiftDate}>Show all</button></div><div className="rolling-calendar-days">{Array.from({length:42},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const today=i===0;return <button type="button" key={key} className={`rolling-calendar-day${selectedShiftDate===key?' selected':''}${today?' today':''}`} aria-pressed={selectedShiftDate===key} onClick={()=>{setSelectedShiftDate(key);window.setTimeout(()=>document.querySelector('.shift-card.selected-date-shift')?.scrollIntoView({behavior:'smooth',block:'center'}),50)}}><small>{d.toLocaleDateString('en-GB',{weekday:'short'})}</small><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('en-GB',{month:'short'})}</span></button>})}</div></div><div className="find-shifts-search"><input className="search" placeholder="Search role or location" value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" className="secondary shift-filter-toggle" aria-expanded={showShiftFilters} onClick={()=>setShowShiftFilters(v=>!v)}>Filters {showShiftFilters?'−':'＋'}</button></div>{showShiftFilters&&<div className="shift-filters"><label>Shift type<select value={shiftTypeFilter} onChange={e=>setShiftTypeFilter(e.target.value)}><option value="all">All types</option><option value="hospitality">Hospitality</option><option value="bar">Bar work</option><option value="warehouse">Warehouse</option><option value="office">Office</option><option value="retail">Retail</option><option value="event">Events & festivals</option><option value="clean">Cleaning</option></select></label><label>Minimum hourly rate (£)<input type="number" min="0" step="0.50" value={minHourlyRate} onChange={e=>setMinHourlyRate(e.target.value)} placeholder="Any"/></label><label>Maximum hourly rate (£)<input type="number" min="0" step="0.50" value={maxHourlyRate} onChange={e=>setMaxHourlyRate(e.target.value)} placeholder="Any"/></label><label>Role<select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="all">All roles</option>{shiftRoles.map(r=><option key={r} value={r}>{r}</option>)}</select></label><label>Distance from home (miles)<select value={maxDistance} onChange={e=>setMaxDistance(e.target.value)}><option value="">Any distance</option><option value="5">Within 5 miles</option><option value="10">Within 10 miles</option><option value="25">Within 25 miles</option><option value="50">Within 50 miles</option></select></label><label>Date<input type="date" value={selectedShiftDate} onChange={e=>setSelectedShiftDate(e.target.value)}/></label><button type="button" className="secondary" onClick={()=>{setShiftTypeFilter('all');setMinHourlyRate('');setMaxHourlyRate('');setMaxDistance('');setRoleFilter('all');setSelectedShiftDate('');setSearch('')}}>Reset filters</button></div>{user.role==='worker'&&<div className="worker-section-links job-tabs">{[['available','Available shifts'],['applied','Applied shifts'],['upcoming','Upcoming shifts'],['rejected','Rejected shifts'],['completed','Completed shifts']].map(([id,label])=><button key={id} className={jobFilter===id?'selected':''} onClick={()=>setJobFilter(id)}>{label}</button>)}</div>}{user.role==='worker'&&jobFilter!=='available'?<DataList items={applications.filter(a=>jobFilter==='applied'?a.status==='pending':jobFilter==='upcoming'?a.status==='approved':jobFilter==='rejected'?a.status==='rejected':a.status==='completed')} empty={'No '+jobFilter+' shifts yet.'} render={a=><article className="admin-record" key={a.id}><strong>{a.title}</strong><small>{a.business_name||'Employer'} · {a.starts_at||'Date to be confirmed'}</small><span className={'status '+a.status}>{a.status}</span></article>}/>:<ShiftList shifts={visibleShifts} role={user.role} apply={apply} selectedDate={selectedShiftDate}/>}</section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='post'&&user.role==='employer'&&<section className="panel"><h2>Shift details</h2><form onSubmit={createShift} className="formgrid">{[['title','Role / title'],['location','Location'],['startsAt','Start date and time'],['endsAt','End date and time'],['hourlyPay','Hourly pay (£)'],['slots','Number of workers'],['breakMinutes','Unpaid break (minutes)']].map(([k,l])=><label key={k}>{l}<input required type={['startsAt','endsAt'].includes(k)?'datetime-local':k==='title'||k==='location'?'text':'number'} min={['hourlyPay','slots','breakMinutes'].includes(k)?'0':undefined} step={k==='hourlyPay'?'0.01':undefined} value={shift[k]} onChange={e=>setShift({...shift,[k]:e.target.value})}/></label>)}<label className="wide">Description<textarea value={shift.description} onChange={e=>setShift({...shift,description:e.target.value})}/></label><button className="primary">Publish shift</button></form></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='applications'&&<section className="panel"><h2>Applications</h2><DataList items={applications} empty="No applications yet." render={a=><div className="row" key={a.id}><div><b>{a.title}</b><small>{a.business_name||`${a.first_name||''} ${a.last_name||''}`} · {a.starts_at}</small></div><span className={`status ${a.status}`}>{a.status}</span>{user.role==='employer'&&a.status==='pending'&&<div className="actions"><button onClick={()=>updateApplication(a.id,'approved')}>Approve</button><button onClick={()=>updateApplication(a.id,'rejected')}>Reject</button></div>}</div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='checkouts'&&<section className="panel"><h2>Timesheets & checkouts</h2><DataList items={checkouts} empty="No checkouts yet." render={c=><div className="row" key={c.id}><div><b>{c.title||`Checkout #${c.id}`}</b><small>{c.actual_start} – {c.actual_end} · Gross {money(c.gross_pay)} · Fee {money(c.platform_fee)}</small></div><span className={`status ${c.status}`}>{c.status}</span>{['employer','admin'].includes(user.role)&&c.status==='submitted'&&<button onClick={()=>action(async()=>{await request(`/checkouts/${c.id}/review`,{method:'PATCH',body:JSON.stringify({status:'approved'})});await load()})}>Approve</button>}{user.role==='employer'&&['submitted','disputed'].includes(c.status)&&<CounterOfferForm checkout={c} action={action} busy={busy} onDone={load} setNotice={setNotice}/>}</div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='invoices'&&<section className="panel"><h2>Invoices</h2><DataList items={invoices} empty="No invoices yet." render={i=><div className="row" key={i.id}><div><b>Invoice #{i.id} · {i.title}</b><small>Due {i.due_at} · Platform fee {money(i.platform_fee)}</small></div><strong>{money(i.total)}</strong><span className={`status ${i.status}`}>{i.status}</span></div>}/></section>}

 {user?.role==='worker'&&page==='inbox'&&<section className="panel"><button className="textbutton" onClick={goBack}>← Back</button><h2>Inbox</h2><p>Messages are grouped by who sent them so you can find employer and admin conversations quickly.</p><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/></section>}
 {user?.role==='worker'&&page==='availability'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Availability</h2><p>Set the days, times, travel distance and minimum earnings that work for you. Automatic shift approval and saved preferences still need their backend workflow connected.</p><div className="availability-preview"><label><input type="checkbox"/> Enable automatic shift matching</label><div className="grid2"><label>Minimum earnings per shift (£)<input type="number" min="0" placeholder="e.g. 80" /></label><label>Maximum travel distance (miles)<input type="number" min="1" placeholder="e.g. 10" /></label></div><p className="muted">Preference controls are a design preview and are not saved yet.</p><button className="primary" disabled>Save availability (coming next)</button></div></section>}
 {user?.role==='worker'&&page==='favourites'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Favourites</h2><div className="worker-section-links"><button className="secondary">Search workplaces</button><button className="secondary">Previous employers</button></div><p>Your favourite workplaces and prioritisation list will appear here when workplace favourites are connected.</p><p className="muted">Workplace search, distance filters and preference ordering are not connected yet.</p></section>}
 {user?.role==='worker'&&page==='complaints'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Complaints</h2><p>Report concerns about a client, a person or conditions at a work site. Your message is sent to hyrz support.</p><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/></section>}
 {user?.role==='worker'&&page==='timetable'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Your next six weeks</h2><p>Your schedule will show approved shifts and update when shifts are accepted or rescinded.</p><DataList items={applications.filter(a=>a.status==='approved').sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))} empty="No upcoming approved shifts." render={a=><article className="admin-record" key={a.id}><strong>{a.title}</strong><small>{a.business_name||'Employer'} · {a.starts_at||'Date to be confirmed'}</small></article>}/></section>}
 {user?.role==='worker'&&page==='notifications'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Notifications</h2><p>Shift decisions, checkout reminders and messages from hyrz will appear here once the notification feed and email reminders are connected.</p><div className="empty-state">You're all caught up.</div></section>}
 {user?.role==='worker'&&page==='workchats'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Workchats</h2><p>Group conversations for employers who have added you to their favourites will appear here.</p><div className="empty-state">No workchats available yet.</div></section>}
 {user?.role==='worker'&&page==='contact'&&<SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/>}

 {user&&page==='account'&&<AccountSettings user={user} setUser={setUser} action={action} busy={busy} setNotice={setNotice}/>}

 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='admin'&&user.role==='admin'&&<AdminConsole user={user} action={action} setNotice={setNotice} setError={setError} busy={busy}/>}

 
  </main>{user?.role==='worker'&&<nav className="worker-bottom-nav" aria-label="Worker navigation">{[['dashboard','Dashboard','⌂'],['jobs','Jobs','⌕'],['account','Profile','◉'],['workchats','Workchats','☏'],['contact','Contact','✉']].map(([id,label,icon])=><button key={id} className={page===id?'active':''} onClick={()=>{setPageHistory([]);setPage(id);}}><span>{icon}</span><small>{label}</small></button>)}</nav>}{user?.role==='employer'&&<nav className="employer-bottom-nav" aria-label="Employer navigation">{[['dashboard','Dashboard','⌂'],['contact','Contact','✉'],['account','Profile','◉'],['workchats','Workchat','☏']].map(([id,label,icon])=><button key={id} className={page===id?'active':''} onClick={()=>{setPageHistory([]);setPage(id);}}><span>{icon}</span><small>{label}</small></button>)}</nav>}</div>
}
function AccountSettings({user,setUser,action,busy,setNotice}) {
 const [firstName,setFirstName]=useState(user.first_name||(user.role==='admin'?'Simson':''));
 const [lastName,setLastName]=useState(user.last_name||(user.role==='admin'?'Hannawell':''));
 const [showPasswordEditor,setShowPasswordEditor]=useState(false);
 const [currentPassword,setCurrentPassword]=useState('');
 const [newPassword,setNewPassword]=useState('');
 const [confirmNewPassword,setConfirmNewPassword]=useState('');
 const [profilePicture,setProfilePicture]=useState(user.profile_picture||'');
 async function saveProfilePicture(nextPicture) {
  await action(async()=>{
   const result=await request('/auth/profile',{method:'PATCH',body:JSON.stringify({profilePicture:nextPicture})});
   setUser(result.user);
   setProfilePicture(result.user.profile_picture||'');
   setNotice(nextPicture?'Your profile photo has been saved.':'Your profile photo has been removed.');
  });
 }
 async function changePassword(e) {
  e.preventDefault();
  await action(async()=>{
   if(newPassword!==confirmNewPassword) throw new Error('Your new passwords do not match.');
   await request('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
   setCurrentPassword('');setNewPassword('');setConfirmNewPassword('');
   setNotice('Your password has been changed successfully.');
   setShowPasswordEditor(false);
  });
 }
 return <section className="panel account-settings">
  <h2>My profile</h2>
  <div className="profile-picture-editor">
   {profilePicture?<img className="profile-picture-preview" src={profilePicture} alt="Your profile" />:<div className="profile-picture-placeholder" aria-label="No profile photo"> {(firstName||user.email||'U').slice(0,1).toUpperCase()} </div>}
   <div><label>Profile picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{
     const file=e.target.files?.[0];if(!file)return;
     if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){e.target.value='';window.alert('Choose a PNG, JPG, WEBP or GIF image.');return;}
     if(file.size>400*1024){e.target.value='';window.alert('Choose an image smaller than 400 KB.');return;}
     const reader=new FileReader();reader.onload=()=>{const image=String(reader.result||'');if(image)saveProfilePicture(image);};reader.readAsDataURL(file);
   }}/></label>
   <small>PNG, JPG, WEBP or GIF. Maximum 400 KB. Your photo saves automatically after upload.</small>
   {profilePicture&&<button type="button" className="secondary" disabled={busy} onClick={()=>saveProfilePicture('')}>Remove picture</button>}</div>
  </div>
  <hr/>
  <div className="account-password-heading"><h2>Name and email</h2></div>
  <label>First name<input type="text" value={user.first_name||(user.role==='admin'?'Simson':'')} readOnly aria-readonly="true"/></label>
  <label>Last name<input type="text" value={user.last_name||(user.role==='admin'?'Hannawell':'')} readOnly aria-readonly="true"/></label>
  <label>Email address<input type="email" value={user.email||''} readOnly aria-readonly="true"/></label>
  <hr/>
  <div className="account-password-heading"><h2>Password</h2><button type="button" className="password-edit-button" aria-label="Edit password" title="Edit password" onClick={()=>setShowPasswordEditor(v=>!v)}>{showPasswordEditor?'Cancel':'✎ Edit'}</button></div>
  {showPasswordEditor&&<>
  <p>Choose a unique password of at least 12 characters. You'll need your current password to confirm the change.</p>
  <form className="admin-message-form" onSubmit={changePassword}>
   <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></label>
   <label>New password<input type="password" autoComplete="new-password" minLength="12" required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
   <label>Confirm new password<input type="password" autoComplete="new-password" minLength="12" required value={confirmNewPassword} onChange={e=>setConfirmNewPassword(e.target.value)}/></label>
   <button className="secondary" disabled={busy}>Change password</button>
  </form>
  </>}
 </section>;
}

function ShiftList({shifts,role,apply,selectedDate}){return <DataList items={shifts} empty="No open shifts found for these filters." render={s=><article className={"shiftrow shift-card"+(selectedDate&&String(s.starts_at||"").slice(0,10)===selectedDate?" selected-date-shift":"")} key={s.id}><div className="shift-employer-avatar">{s.employer_profile_picture?<img src={s.employer_profile_picture} alt={`${s.business_name||'Employer'} profile`}/>:<span aria-label="No profile picture uploaded" title="No profile picture uploaded">{(s.business_name||'H').trim().charAt(0).toUpperCase()}</span>}</div><div className="shiftmain"><b>{s.title}</b><small className="shift-business">{s.business_name||'Employer'} · {s.location}</small><div className="shift-schedule"><div className="shift-schedule-row"><span className="shift-meta-label">DATE</span><strong>{new Date(s.starts_at).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</strong></div><div className="shift-schedule-row"><span className="shift-meta-label">TIME</span><strong>{new Date(s.starts_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} – {new Date(s.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</strong></div><div className="shift-schedule-row"><span className="shift-meta-label">TOTAL SHIFT RATE</span><strong>{money(Number(s.hourly_pay||0)*Math.max(0,(new Date(s.ends_at)-new Date(s.starts_at))/3600000))}</strong></div></div></div><div className="shiftpay"><span className="shift-meta-label">HOURLY RATE</span><strong>{money(s.hourly_pay)}<small>/hr</small></strong>{role==='worker'&&<button onClick={()=>apply(s.id)}>Apply for shift ↗</button>}</div></article>}/>}
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

function AdminConsole({user,action,setNotice,setError,busy}) {
 const [section,setSection]=useState('INBOX');
 const [sub,setSub]=useState('CLIENTS');
 const [users,setUsers]=useState([]);
 const [verificationAccounts,setVerificationAccounts]=useState([]);
 const [invoices,setInvoices]=useState([]);
 const [financialReport,setFinancialReport]=useState(null);
 const [commissionReferrer,setCommissionReferrer]=useState('');const [commissionReferred,setCommissionReferred]=useState('');const [commissionAmount,setCommissionAmount]=useState('');
 const [logs,setLogs]=useState([]);
 const [disputes,setDisputes]=useState([]);
 const [messages,setMessages]=useState([]);
 const [loading,setLoading]=useState(false);
 const [overview,setOverview]=useState(null);
 const [messageBody,setMessageBody]=useState('');
 const [messageSubject,setMessageSubject]=useState('');
 const [recipientId,setRecipientId]=useState('');
 const [category,setCategory]=useState('enquiries');
 const [invoiceFilter,setInvoiceFilter]=useState('all');
 const [newAdminEmail,setNewAdminEmail]=useState('');const [newAdminPassword,setNewAdminPassword]=useState('');const [newAdminTier,setNewAdminTier]=useState('3');
 const [currentPassword,setCurrentPassword]=useState('');const [newPassword,setNewPassword]=useState('');
 const [disputeResolution,setDisputeResolution]=useState({});
 const sections=Number(user.admin_tier)===1?['INBOX','USERS','FINANCIAL REPORTS','INVOICES','ADMIN ACTIONS','CHECKOUT DISPUTES']:['INBOX','USERS','INVOICES','ADMIN ACTIONS','CHECKOUT DISPUTES'];
 async function refresh() {
  setLoading(true);setError('');
  try {
   const summary=await request('/admin/overview');setOverview(summary);
   const invoiceSummary=await request('/admin/invoices');setInvoices(invoiceSummary.invoices||[]);
   if(section==='USERS') {const r=await request('/admin/users');setUsers(r.users||[]);if(Number(user.admin_tier)<=2){const q=await request('/admin/verification-queue');setVerificationAccounts(q.accounts||[]);}}
   if(section==='INVOICES') { /* invoice list loaded above for the dashboard counters */ }
   if(section==='FINANCIAL REPORTS') {const r=await request('/admin/financial-reports');setFinancialReport(r);}
   if(section==='ADMIN ACTIONS') {const r=await request('/admin/audit-logs');setLogs(r.logs||[]);}
   if(section==='CHECKOUT DISPUTES') {const r=await request('/admin/disputes');setDisputes(r.disputes||[]);}
   if(section==='INBOX') {const r=await request('/admin/inbox');setMessages(r.messages||[]);}
  } catch(e) {setError(e.message);}
  finally {setLoading(false);}
 }
 useEffect(()=>{refresh();},[section]);
 const fmtDate=v=>v?new Date(v).toLocaleString('en-GB'):'—';
 async function setStatus(u,status) {
  const verb=status==='blocked'?'block':'unblock';
  if(!window.confirm('Are you sure you want to '+verb+' '+u.email+'? This action will be recorded.'))return;
  await action(async()=>{await request('/admin/users/'+u.id+'/status',{method:'PATCH',body:JSON.stringify({status})});setNotice('User '+(status==='blocked'?'blocked':'unblocked')+'.');await refresh();});
 }
 async function updateInvoice(i,status) {
  if(!window.confirm('Confirm changing invoice #'+i.id+' to '+status+'?'))return;
  await action(async()=>{await request('/admin/invoices/'+i.id+'/status',{method:'PATCH',body:JSON.stringify({status})});setNotice('Invoice updated.');await refresh();});
 }
 async function resolve(d,outcome) {
  const resolution=window.prompt('Enter the full reason for this checkout decision (at least 5 characters):');
  if(resolution===null)return;
  if(resolution.trim().length<5){setError('Please provide a fuller resolution reason.');return;}
  const corrections=disputeResolution[d.id]||{};
  const proposed=outcome==='employer'?{actualStart:corrections.actualStart||d.counter_start||undefined,actualEnd:corrections.actualEnd||d.counter_end||undefined,breakMinutes:corrections.breakMinutes??d.counter_break_minutes??undefined}:corrections;
  await action(async()=>{await request('/admin/disputes/'+d.id+'/resolve',{method:'PATCH',body:JSON.stringify({outcome,resolution:resolution.trim(),...proposed})});setNotice('Dispute decision saved and audit logged.');await refresh();});
 }
 async function sendMessage(e) {
  e.preventDefault();
  await action(async()=>{await request('/admin/messages',{method:'POST',body:JSON.stringify({recipientId:Number(recipientId),category,subject:messageSubject,body:messageBody})});setMessageBody('');setMessageSubject('');setNotice('Message sent.');await refresh();});
 }
 const userList=users.filter(u=>sub==='ADMINS'?u.role==='admin':sub==='CLIENTS'?u.role==='employer':u.role==='worker');
 return <section className="panel admin-console">
  <div className="panel-head"><div><span className="eyebrow">ADMINISTRATION · TIER {user.admin_tier||'—'}</span><h2>{section}</h2></div><button className="secondary" onClick={refresh} disabled={loading}>{loading?'Loading…':'Refresh'}</button></div>
  {overview&&<div className="stats admin-overview-stats"><button type="button" className="stat admin-counter" onClick={()=>setSection('INBOX')}><small>UNREAD / UNHANDLED MESSAGES</small><strong>{messages.filter(m=>!m.read_at&&!m.opened_by).length}</strong></button><button type="button" className="stat admin-counter" onClick={()=>setSection('CHECKOUT DISPUTES')}><small>UNRESOLVED CHECKOUT DISPUTES</small><strong>{disputes.filter(d=>!['resolved','closed'].includes(String(d.status||'').toLowerCase())).length}</strong></button><button type="button" className="stat admin-counter" onClick={()=>setSection('ADMIN ACTIONS')}><small>ADMIN ACTIONS TO REVIEW</small><strong>{logs.filter(l=>!l.seen_at&&!l.opened_at).length}</strong></button><button type="button" className="stat admin-counter" onClick={()=>setSection('INVOICES')}><small>OVERDUE INVOICES</small><strong>{invoices.filter(i=>!["paid","void"].includes(String(i.status||"").toLowerCase())&&(String(i.status||"").toLowerCase()==="overdue"||(i.due_at&&new Date(i.due_at).getTime()<new Date(new Date().toDateString()).getTime()))).length}</strong></button></div>}
  <nav className="admin-tabs">{sections.map(s=><button key={s} className={section===s?'selected':''} onClick={()=>setSection(s)}>{s}</button>)}</nav>
  {section==='USERS'&&<><nav className="admin-tabs">{['ADMINS','CLIENTS','WORKERS',...(Number(user.admin_tier)<=2?['VERIFICATION']:[])].map(s=><button key={s} className={sub===s?'selected':''} onClick={()=>setSub(s)}>{s}</button>)}<button onClick={()=>setSub('BLOCKED CLIENTS')}>BLOCKED CLIENTS</button><button onClick={()=>setSub('BLOCKED WORKERS')}>BLOCKED WORKERS</button></nav>
   {sub==='VERIFICATION'&&Number(user.admin_tier)<=2&&<DataList items={verificationAccounts} empty="No accounts waiting for manual verification." render={a=><article className="admin-record" key={a.role+'-'+a.userId}><strong>{a.firstName||''} {a.lastName||''} · {a.email}</strong><small>{a.role} · Email verified: {a.emailVerified?'Yes':'No'} · Registered {a.createdAt?new Date(a.createdAt).toLocaleString('en-GB'):'—'}</small>{a.businessName&&<small>{a.businessName} · Company number {a.companyNumber||'not supplied'}</small>}<div className="verification-admin-controls">{(a.role==='worker'?[['identity','Identity',a.identityStatus],['right_to_work','Right to work',a.rightToWorkStatus]]:[['identity','Identity',a.identityStatus],['company','Company',a.companyStatus]]).map(([check,title,status])=><ReviewControl key={check} title={title+' · '+(status||'not_started')} status={status} onChoose={next=>{const reason=window.prompt('Required audit reason for setting '+title+' to '+next+':');if(reason===null)return;if(reason.trim().length<3){setError('Please enter a review reason of at least 3 characters.');return;}action(async()=>{await request('/admin/verification/'+a.role+'/'+a.userId,{method:'PATCH',body:JSON.stringify({check,status:next,reason})});setNotice(title+' verification updated.');await refresh();});}}/> )}</div></article>}/>}
   {sub==='ADMINS'&&Number(user.admin_tier)<=2&&<form className="admin-message-form" onSubmit={e=>{e.preventDefault();action(async()=>{const r=await request('/admin/admins',{method:'POST',body:JSON.stringify({email:newAdminEmail,password:newAdminPassword,tier:Number(newAdminTier)})});setNewAdminEmail('');setNewAdminPassword('');setNotice('Administrator created: '+(r.email||newAdminEmail));await refresh();});}}><h3>Create administrator</h3><label>Email<input type="email" required value={newAdminEmail} onChange={e=>setNewAdminEmail(e.target.value)}/></label><label>Initial password (12+ characters)<input type="password" minLength="12" required value={newAdminPassword} onChange={e=>setNewAdminPassword(e.target.value)}/></label><label>Administrator tier<select value={newAdminTier} onChange={e=>setNewAdminTier(e.target.value)}>{Number(user.admin_tier)===1&&<option value="1">Tier 1</option>}{Number(user.admin_tier)===1&&<option value="2">Tier 2</option>}{Number(user.admin_tier)===2&&<option value="3">Tier 3</option>}{Number(user.admin_tier)===1&&<option value="3">Tier 3</option>}</select></label><button className="primary" disabled={busy}>Create admin</button></form>}
   <DataList items={users.filter(u=>sub==='BLOCKED CLIENTS'?u.role==='employer'&&u.status==='blocked':sub==='BLOCKED WORKERS'?u.role==='worker'&&u.status==='blocked':userList.includes(u))} empty="No matching users." render={u=><article className="admin-record" key={u.id}><div className="admin-record-head"><div><strong>{u.first_name||''} {u.last_name||''}</strong><small>{u.email} · {u.role}{u.admin_tier?' · Tier '+u.admin_tier:''} · {u.status}</small><small>{u.phone||'No phone recorded'}{u.business_name?' · '+u.business_name:''}{u.company_number?' · Company '+u.company_number:''}{u.worker_postcode||u.business_postcode?' · '+(u.worker_postcode||u.business_postcode):''}</small>{u.role==='worker'&&<small>Identity: {u.worker_identity_status||'not_started'} · Right to work: {u.worker_right_to_work_status||'not_started'} · Rate: {u.worker_hourly_rate?money(u.worker_hourly_rate)+'/hr':'not set'} · Skills: {Array.isArray(u.worker_skills)?u.worker_skills.join(', '):typeof u.worker_skills==='string'?u.worker_skills:u.worker_skills?JSON.stringify(u.worker_skills):'not listed'}</small>}{u.role==='employer'&&<small>Company verification: {u.business_verification_status||'not_started'} · Identity: {u.business_identity_status||'not_started'} · Role: {u.role_at_company||'not supplied'}</small>}</div><span className={'status '+u.status}>{u.status}</span></div>
   {u.role==='admin'&&Number(user.admin_tier)===1&&Number(u.id)!==Number(user.id)&&<div className="admin-record-actions"><label>Tier<select value={u.admin_tier||3} onChange={e=>{const tier=Number(e.target.value);if(window.confirm('Change '+u.email+' to Tier '+tier+'?'))action(async()=>{await request('/admin/admins/'+u.id+'/tier',{method:'PATCH',body:JSON.stringify({tier})});setNotice('Administrator tier updated.');await refresh();});}}>{Number(user.admin_tier)===1&&<option value="1">Tier 1</option>}{Number(user.admin_tier)===1&&<option value="2">Tier 2</option>}{Number(user.admin_tier)===1&&<option value="3">Tier 3</option>}{Number(user.admin_tier)===2&&<option value="3">Tier 3</option>}</select></label><button className="secondary" onClick={()=>{if(window.confirm('Disable administrator access for '+u.email+'? Historical records will be retained.'))action(async()=>{await request('/admin/admins/'+u.id,{method:'DELETE'});setNotice('Administrator deleted.');await refresh();});}}>Delete administrator</button></div>}
   {u.role!=='admin'&&Number(user.admin_tier)!==3&&<div className="admin-record-actions"><button className="secondary" onClick={()=>setStatus(u,u.status==='blocked'?'active':'blocked')}>{u.status==='blocked'?'Unblock user':'Block user'}</button>{u.status!=='pending_deletion'&&<button className="secondary" onClick={()=>{if(window.confirm('Request deletion of '+u.email+'? This disables account access and retains linked financial/audit records.'))action(async()=>{await request('/admin/users/'+u.id,{method:'DELETE'});setNotice('Account access disabled; deletion request recorded.');await refresh();});}}>Delete user</button>}</div>}
   </article>}/></>}
  {section==='INVOICES'&&<><div className="admin-tabs">{['all','overdue','issued','completed','paid','void'].map(f=><button key={f} className={invoiceFilter===f?'selected':''} onClick={()=>setInvoiceFilter(f)}>{f.toUpperCase()}</button>)}</div>
   <DataList items={invoices.filter(i=>invoiceFilter==='all'||(invoiceFilter==='overdue'&&(i.status==='overdue'||new Date(i.due_at)<new Date(new Date().toISOString().slice(0,10))))||(invoiceFilter==='completed'&&i.status==='paid')||i.status===invoiceFilter)} empty="No invoices in this category." render={i=><article className="admin-record" key={i.id}><div className="admin-record-head"><div><strong>Invoice #{i.id} · {i.business_name}</strong><small>{i.shift_title} · Due {String(i.due_at).slice(0,10)} · {i.status}</small><small>Client: {i.client_first_name||''} {i.client_last_name||''} · {i.client_email} · {i.client_phone||'No phone recorded'}</small><small>Address/postcode: {i.business_postcode||'Not recorded'} · Company no: {i.company_number||'Not recorded'}</small></div><strong>{money(i.total)}</strong></div><div className="admin-record-actions">{i.status!=='paid'&&<button className="secondary" onClick={()=>updateInvoice(i,'paid')}>Mark paid</button>}{i.status!=='void'&&<button className="secondary" onClick={()=>updateInvoice(i,'void')}>Void invoice</button>}<a href={'mailto:'+i.client_email+'?subject='+encodeURIComponent('hyrz invoice #'+i.id)} className="admin-link">Email client</a>{!['paid','void'].includes(i.status)&&<button className="secondary" onClick={()=>{if(window.confirm('Send an invoice reminder to '+i.client_email+'?'))action(async()=>{await request('/admin/invoices/'+i.id+'/send-reminder',{method:'POST',body:'{}'});setNotice('Invoice reminder sent.');await refresh();});}}>Send reminder</button>}</div></article>}/></>}
  {section==='ADMIN ACTIONS'&&<DataList items={logs} empty="No administrative actions recorded yet." render={l=><article className="admin-record" key={l.id}><div className="admin-record-head"><div><strong>{l.action}</strong><small>{l.admin_email||'Former administrator'}{l.admin_tier?' · Tier '+l.admin_tier:''} · {fmtDate(l.created_at)}</small><small>{l.entity_type} #{l.entity_id||'—'} · IP {l.ip_address||'—'}</small><pre>{typeof l.details==='string'?l.details:JSON.stringify(l.details||{},null,2)}</pre></div></div></article>}/>}
  {section==='CHECKOUT DISPUTES'&&<DataList items={disputes} empty="No checkout disputes found." render={d=><article className="admin-record" key={d.id}><div className="admin-record-head"><div><strong>Dispute #{d.id} · Checkout #{d.checkout_id} · {d.status}</strong><small>{d.shift_title} · {d.business_name} · {d.shift_location}</small><small>Employer: {d.employer_first_name||''} {d.employer_last_name||''} · {d.employer_email}</small><small>Worker: {d.worker_first_name||''} {d.worker_last_name||''} · {d.worker_email}</small><small>Opened by {d.opened_by_email} · {fmtDate(d.created_at)} · Assigned to {d.assigned_admin_email||'No one'}</small><p><b>Employer/complaint reason:</b> {d.reason}</p>{d.evidence_url&&<p><a className="admin-link" href={d.evidence_url} target="_blank" rel="noreferrer">Open submitted evidence</a></p>}<p><b>Worker comment:</b> {d.worker_comment||'No worker comment recorded.'}</p><p><b>Employer comment/counter-offer:</b> {d.employer_comment||'No employer counter-offer recorded.'}</p>{d.counter_start&&<p><b>Employer proposed times:</b> {fmtDate(d.counter_start)} – {fmtDate(d.counter_end)} · Break {d.counter_break_minutes} min · Proposed gross {money(d.counter_gross_pay)}</p>}<p><b>Checkout times:</b> {fmtDate(d.actual_start)} – {fmtDate(d.actual_end)} · Break {d.break_minutes} min · Gross {money(d.gross_pay)} · Fee {money(d.platform_fee)}</p>{d.resolution&&<p><b>Resolution:</b> {d.resolution}</p>}</div></div>{['open','assigned'].includes(d.status)&&<><label>Corrected work/break timings (optional)<input placeholder="Actual start (YYYY-MM-DD HH:MM:SS)" onChange={e=>setDisputeResolution(p=>({...p,[d.id]:{...p[d.id],actualStart:e.target.value||undefined}}))}/><input placeholder="Actual end (YYYY-MM-DD HH:MM:SS)" onChange={e=>setDisputeResolution(p=>({...p,[d.id]:{...p[d.id],actualEnd:e.target.value||undefined}}))}/><input type="number" min="0" placeholder="Correct break minutes" onChange={e=>setDisputeResolution(p=>({...p,[d.id]:{...p[d.id],breakMinutes:e.target.value===''?undefined:Number(e.target.value)}}))}/></label><div className="admin-record-actions"><button className="secondary" onClick={()=>action(async()=>{await request('/admin/disputes/'+d.id+'/assign',{method:'PATCH',body:'{}'});setNotice('Dispute assigned to you.');await refresh();})}>Assign to me</button><button className="primary" onClick={()=>resolve(d,'worker')}>Uphold worker checkout</button><button className="secondary" onClick={()=>resolve(d,'employer')}>Uphold employer counter-offer</button><button className="secondary" onClick={()=>resolve(d,'reject')}>Reject checkout</button></div></>}</article>}/>}
  {section==='INBOX'&&<><div className="admin-tabs">{['checkout_disputes','complaints','enquiries','admins'].map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c.replace('_',' ').toUpperCase()}</button>)}</div>
   <DataList items={messages.filter(m=>category==='admins'?(m.sender_role==='admin'||Number(m.recipient_id)>0&&m.category==='admins'):category==='enquiries'?(m.category==='enquiries'||!m.category):m.category===category)} empty="No messages in this subject yet." render={m=><article className="admin-record" key={m.id}><div className="admin-record-head"><div><strong>Message #{m.id} · {m.sender_email} ({m.sender_role})</strong><small>{fmtDate(m.created_at)} · {m.subject||'No subject'} · {m.category||'Uncategorised'} · {m.read_at?'Read':'Unread'} · {m.opened_by_email?'Handled by '+m.opened_by_email:'Not claimed'}</small><small>Conversation {m.conversation_key}</small><p>{m.body}</p><div className="admin-record-actions">{!m.opened_by&&<button className="secondary" onClick={()=>action(async()=>{await request('/admin/messages/'+m.id+'/claim',{method:'PATCH',body:'{}'});setNotice('Issue claimed by you.');await refresh();})}>Mark as handling</button>}{Number(m.recipient_id)===Number(user.id)&&!m.read_at&&<button className="secondary" onClick={()=>action(async()=>{await request('/admin/messages/'+m.id+'/read',{method:'PATCH',body:'{}'});setNotice('Message marked as read.');await refresh();})}>Mark read</button>}</div></div></div></article>}/>
   <form onSubmit={sendMessage} className="admin-message-form"><h3>Send a message</h3><label>Subject<input required maxLength="200" value={messageSubject} onChange={e=>setMessageSubject(e.target.value)}/></label><label>Recipient user ID<input type="number" min="1" required value={recipientId} onChange={e=>setRecipientId(e.target.value)}/></label><label>Message<textarea required maxLength="5000" value={messageBody} onChange={e=>setMessageBody(e.target.value)}/></label><button className="primary" disabled={busy}>Send message</button></form>
  </>}

  {section==='FINANCIAL REPORTS'&&<>{financialReport&&<><div className="stats"><div className="stat"><small>TOTAL USERS</small><strong>{financialReport.userCounts.totalUsers||0}</strong></div><div className="stat"><small>WORKERS</small><strong>{financialReport.userCounts.workers||0}</strong></div><div className="stat"><small>CLIENTS</small><strong>{financialReport.userCounts.clients||0}</strong></div><div className="stat"><small>ADMINS</small><strong>{financialReport.userCounts.admins||0}</strong></div></div><div className="stats"><div className="stat"><small>PLATFORM FEES INVOICED</small><strong>{money(financialReport.invoices.invoicedRevenue)}</strong></div><div className="stat"><small>PAID REVENUE</small><strong>{money(financialReport.invoices.paidRevenue)}</strong></div><div className="stat"><small>OUTSTANDING</small><strong>{money(financialReport.invoices.outstandingRevenue)}</strong></div><div className="stat"><small>OVERDUE INVOICES</small><strong>{financialReport.invoices.overdueInvoices||0}</strong></div></div><p className="admin-note">Gross value of all invoices, including worker pay and platform fees: {money(financialReport.invoices.grossInvoiceValue)}.</p><h3>Referral commissions</h3><div className="admin-note">Commission totals reflect entries in the referral ledger. No referral attribution or automatic commission calculation is configured yet.</div><div className="stats"><div className="stat"><small>PENDING</small><strong>{money(financialReport.commissions.pendingCommissions)}</strong></div><div className="stat"><small>APPROVED</small><strong>{money(financialReport.commissions.approvedCommissions)}</strong></div><div className="stat"><small>PAID</small><strong>{money(financialReport.commissions.paidCommissions)}</strong></div></div><form className="admin-message-form" onSubmit={e=>{e.preventDefault();action(async()=>{await request('/admin/referral-commissions',{method:'POST',body:JSON.stringify({referrerUserId:Number(commissionReferrer),referredUserId:Number(commissionReferred),amount:Number(commissionAmount)})});setCommissionReferrer('');setCommissionReferred('');setCommissionAmount('');setNotice('Referral commission recorded as pending.');await refresh();});}}><h3>Record referral commission</h3><p>Enter the referring and referred user IDs and the agreed amount. The system does not calculate a commission rate automatically.</p><div className="grid2"><label>Referrer user ID<input type="number" min="1" required value={commissionReferrer} onChange={e=>setCommissionReferrer(e.target.value)}/></label><label>Referred user ID<input type="number" min="1" required value={commissionReferred} onChange={e=>setCommissionReferred(e.target.value)}/></label></div><label>Commission amount (£)<input type="number" min="0.01" max="1000000" step="0.01" required value={commissionAmount} onChange={e=>setCommissionAmount(e.target.value)}/></label><button className="primary" disabled={busy}>Record commission</button></form><DataList items={financialReport.referralCommissions||[]} empty="No referral commissions recorded." render={c=><article className="admin-record" key={c.id}><strong>Commission #{c.id} · {money(c.amount)} · {c.status}</strong><small>Referrer: {c.referrer_email} · Referred account: {c.referred_email} · {fmtDate(c.created_at)}</small><div className="admin-record-actions">{['pending','approved','paid','cancelled'].filter(x=>x!==c.status).map(status=><button key={status} className="secondary" onClick={()=>{if(window.confirm('Change commission #'+c.id+' to '+status+'?'))action(async()=>{await request('/admin/referral-commissions/'+c.id+'/status',{method:'PATCH',body:JSON.stringify({status})});setNotice('Referral commission updated.');await refresh();});}}>{status}</button>)}</div></article>}/></>}</>}
 </section>;
}

function SupportContact({user,action,busy,setNotice,setError}) {
 const [category,setCategory]=useState('enquiries');
 const [subject,setSubject]=useState('');
 const [body,setBody]=useState('');
 const [recipientId,setRecipientId]=useState('');
 const [messages,setMessages]=useState([]);
 const [sent,setSent]=useState(false);
 async function refreshMessages(){try{const r=await request('/messages/mine');setMessages(r.messages||[]);}catch(e){setError(e.message);}}
 useEffect(()=>{refreshMessages();},[]);
 async function submit(e){e.preventDefault();setSent(false);await action(async()=>{await request('/messages',{method:'POST',body:JSON.stringify({category,subject,body,...(recipientId?{recipientId:Number(recipientId)}:{})})});setBody('');setSubject('');setRecipientId('');setSent(true);setNotice('Your message has been sent to hyrz support.');await refreshMessages();});}
 function reply(m){setRecipientId(String(m.sender_id===user.id?m.recipient_id:m.sender_id));setCategory(m.category||'enquiries');setSubject('Re: '+(m.subject||'your message').replace(/^Re:\s*/i,''));window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}
 return <section className="panel admin-message-form"><h2>Contact hyrz support</h2><p>Send an enquiry, complaint or checkout dispute for the support team to review.</p><form onSubmit={submit}><label>Message type<select value={category} onChange={e=>setCategory(e.target.value)}><option value="enquiries">Enquiry</option><option value="complaints">Complaint</option><option value="checkout_disputes">Checkout dispute</option></select></label><label>Subject<input required minLength="2" maxLength="200" value={subject} onChange={e=>setSubject(e.target.value)}/></label><label>Message<textarea required maxLength="5000" value={body} onChange={e=>setBody(e.target.value)}/></label><button className="primary" disabled={busy}>Send to support</button>{sent&&<p role="status">Message sent successfully.</p>}</form><h3>Your support messages</h3><DataList items={messages} empty="No support messages yet." render={m=><article className="admin-record" key={m.id}><strong>{m.subject||'Support message'} · {(m.category||'enquiries').replace('_',' ')}</strong><small>{new Date(m.created_at).toLocaleString('en-GB')} · {Number(m.sender_id)===Number(user.id)?'You sent this':'hyrz support replied'} · {m.read_at?'Read':'Unread'}</small><p>{m.body}</p>{Number(m.sender_id)!==Number(user.id)&&<button type="button" className="secondary" onClick={()=>reply(m)}>Reply</button>}</article>}/></section>;
}

function CounterOfferForm({checkout,action,busy,onDone,setNotice}) {
 const [open,setOpen]=useState(false);
 const [comment,setComment]=useState('');
 const [actualStart,setActualStart]=useState(String(checkout.actual_start||'').replace(' ','T').slice(0,16));
 const [actualEnd,setActualEnd]=useState(String(checkout.actual_end||'').replace(' ','T').slice(0,16));
 const [breakMinutes,setBreakMinutes]=useState(String(checkout.break_minutes??0));
 return <div className="counter-offer"><button type="button" className="secondary" onClick={()=>setOpen(v=>!v)}>{open?'Cancel counter-offer':'Dispute / counter-offer'}</button>{open&&<form onSubmit={e=>{e.preventDefault();action(async()=>{await request('/checkouts/'+checkout.id+'/counter-offer',{method:'POST',body:JSON.stringify({comment,actualStart:actualStart?actualStart.replace('T',' ')+':00':undefined,actualEnd:actualEnd?actualEnd.replace('T',' ')+':00':undefined,breakMinutes:Number(breakMinutes)})});setNotice('Counter-offer submitted for admin review.');setOpen(false);await onDone();});}}><label>Comment / reason<textarea required minLength="3" maxLength="3000" value={comment} onChange={e=>setComment(e.target.value)}/></label><label>Proposed start<input type="datetime-local" required value={actualStart} onChange={e=>setActualStart(e.target.value)}/></label><label>Proposed end<input type="datetime-local" required value={actualEnd} onChange={e=>setActualEnd(e.target.value)}/></label><label>Proposed break minutes<input type="number" min="0" required value={breakMinutes} onChange={e=>setBreakMinutes(e.target.value)}/></label><button className="primary" disabled={busy}>Submit counter-offer</button></form>}</div>;
}
