import React,{useEffect,useState}from'react';import{request,token}from'../api';
import JOB_ROLE_GROUPS from '../../../shared/job-roles.json';
const JOB_ROLES=JOB_ROLE_GROUPS.flatMap(([,roles])=>roles);
const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n||0));
export default function App(){
 const [user,setUser]=useState(null),[page,setPage]=useState('home'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[onboarding,setOnboarding]=useState(null),[onboardingLoading,setOnboardingLoading]=useState(false);
 const [pageHistory,setPageHistory]=useState([]);
 const mainWorkerPages=['dashboard','jobs','contact','account','workchats','employerInbox','employerShifts','favourites','invoices','checkouts','funds'];
 function navigateTo(next){setPageHistory(previous=>page===next?previous:[...previous,page]);setPage(next);}
 function goBack(){const previous=[...pageHistory];while(previous.length){const candidate=previous.pop();if(mainWorkerPages.includes(candidate)){setPageHistory(previous);setPage(candidate);return;}}setPageHistory([]);setPage(user?.role==='employer'?'workchats':'jobs');}
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[role,setRole]=useState('worker'),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[businessName,setBusinessName]=useState(''),[companyRole,setCompanyRole]=useState(''),[companyNumber,setCompanyNumber]=useState(''),[businessAddress,setBusinessAddress]=useState(''),[businessCity,setBusinessCity]=useState(''),[businessPostcode,setBusinessPostcode]=useState(''),[nationalInsuranceNumber,setNationalInsuranceNumber]=useState(''),[workerPermitNumber,setWorkerPermitNumber]=useState('');
 const [shifts,setShifts]=useState([]),[applications,setApplications]=useState([]),[checkouts,setCheckouts]=useState([]),[invoices,setInvoices]=useState([]),[overview,setOverview]=useState(null),[search,setSearch]=useState(''),[selectedShiftDates,setSelectedShiftDates]=useState([]),[dateFrom,setDateFrom]=useState(''),[dateUntil,setDateUntil]=useState(''),[shiftStartAfter,setShiftStartAfter]=useState(''),[shiftEndBefore,setShiftEndBefore]=useState(''),[shiftTypeFilters,setShiftTypeFilters]=useState([]),[shiftTypePickerOpen,setShiftTypePickerOpen]=useState(false),[minHourlyRate,setMinHourlyRate]=useState('8.00'),[minTotalShiftPay,setMinTotalShiftPay]=useState('20.00'),[shiftRateSort,setShiftRateSort]=useState(''),[maxDistance,setMaxDistance]=useState('10'),[roleFilters,setRoleFilters]=useState([]),[roleSearch,setRoleSearch]=useState(''),[rolePickerOpen,setRolePickerOpen]=useState(false),[showShiftFilters,setShowShiftFilters]=useState(false),[verificationAccounts,setVerificationAccounts]=useState([]),[jobFilter,setJobFilter]=useState('available'),[checkoutFilter,setCheckoutFilter]=useState('all'),[invoiceFilter,setInvoiceFilter]=useState('unpaid');
 const [shift,setShift]=useState({title:'',description:'',shiftType:localStorage.getItem('hyrz_default_shift_type')||'hospitality',startsAt:'',endsAt:'',hourlyPay:'15',slots:1}); const [postDates,setPostDates]=useState([]); const [postStartTime,setPostStartTime]=useState('09:00'); const [postEndTime,setPostEndTime]=useState('17:00'); const [shiftRequirements,setShiftRequirements]=useState(['']);

 // Close the searchable role list when the user clicks outside it or presses Escape.
 useEffect(() => {
   if (!rolePickerOpen && !shiftTypePickerOpen) return;
   function closeOnOutsidePointer(event) {
     if (!event.target.closest('.role-multi-filter')) setRolePickerOpen(false);
     if (!event.target.closest('.shift-type-multi-filter')) setShiftTypePickerOpen(false);
   }
   function closeOnEscape(event) {
     if (event.key === 'Escape') { setRolePickerOpen(false); setShiftTypePickerOpen(false); }
   }
   document.addEventListener('pointerdown', closeOnOutsidePointer);
   document.addEventListener('keydown', closeOnEscape);
   return () => {
     document.removeEventListener('pointerdown', closeOnOutsidePointer);
     document.removeEventListener('keydown', closeOnEscape);
   };
 }, [rolePickerOpen, shiftTypePickerOpen]);

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

 async function createShift(e){e.preventDefault();if(!postDates.length){setError('Select at least one shift date.');return;}if(!shift.title){setError('Choose a job role.');return;}if(!postStartTime||!postEndTime){setError('Choose shift start and end times.');return;}await action(async()=>{const requirements=shiftRequirements.map(x=>x.trim()).filter(Boolean);const description=[shift.description.trim(),requirements.length?'Applicant requirements (must be confirmed):\\n'+requirements.map((x,i)=>(i+1)+'. '+x).join('\\n'):''].filter(Boolean).join('\\n\\n');for(const date of postDates){const startsAt=date+'T'+postStartTime;let endDate=date;if(postEndTime<=postStartTime){const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+1);endDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}const endsAt=endDate+'T'+postEndTime;await request('/shifts',{method:'POST',body:JSON.stringify({...shift,description,location:'Location to be confirmed by employer',startsAt,endsAt,breakMinutes:0})});}setNotice(postDates.length===1?'Shift published':postDates.length+' shifts published');setPostDates([]);setShiftRequirements(['']);await load()})}
 async function apply(id){await action(async()=>{await request(`/shifts/${id}/apply`,{method:'POST',body:'{}'});setNotice('Application submitted');await load()})}
 async function updateApplication(id,status){await action(async()=>{await request(`/applications/${id}`,{method:'PATCH',body:JSON.stringify({status})});await load()})}
 async function reviewVerification(account,check,status){const reason=window.prompt(`Reason for setting ${check.replace('_',' ')} to ${status} for ${account.email}:`);if(reason===null)return;if(reason.trim().length<3){setError('Please enter a reason of at least 3 characters.');return;}await action(async()=>{await request(`/admin/verification/${account.role}/${account.userId}`,{method:'PATCH',body:JSON.stringify({check,status,reason:reason.trim()})});setNotice('Verification status updated and recorded.');await load();})}
 async function logout(){localStorage.removeItem('hyrz_token');setUser(null);navigateTo('home')}
 const shiftRoles=JOB_ROLES; const visibleShifts=shifts.filter(s=>{const matchesText=`${s.title||""} ${s.business_name||""} ${s.location||""}`.toLowerCase().includes(search.trim().toLowerCase());const date=String(s.starts_at||'').slice(0,10);const startDateTime=new Date(s.starts_at),endDateTime=new Date(s.ends_at);const startMinutes=startDateTime.getHours()*60+startDateTime.getMinutes(),endMinutes=endDateTime.getHours()*60+endDateTime.getMinutes();const endFilterNextDay=shiftEndBefore.startsWith('nextday:');const endFilterClock=endFilterNextDay?shiftEndBefore.slice(8):shiftEndBefore;const endsNextDay=endDateTime.toDateString()!==startDateTime.toDateString();const endFilterMinutes=endFilterClock?Number(endFilterClock.slice(0,2))*60+Number(endFilterClock.slice(3,5)):null;const withinEndTime=!shiftEndBefore||(endFilterNextDay?(!endsNextDay||endMinutes<=endFilterMinutes):(!endsNextDay&&endMinutes<=endFilterMinutes));const withinShiftTimes=(!shiftStartAfter||startMinutes>=Number(shiftStartAfter.slice(0,2))*60+Number(shiftStartAfter.slice(3,5)))&&withinEndTime;const hourly=Number(s.hourly_pay||0);const distance=maxDistance===''||Number(s.distance_miles??0)<=Number(maxDistance);const withinDateRange=(!dateFrom||date>=dateFrom)&&(!dateUntil||date<=dateUntil);return matchesText&&withinShiftTimes&&withinDateRange&&(selectedShiftDates.length===0||selectedShiftDates.includes(date))&&(shiftTypeFilters.length===0||shiftTypeFilters.some(type=>{const title=String(s.title||'').toLowerCase();const terms={hospitality:['waiter','waitress','server','hospitality','host','hostess','food runner','catering'],bar:['bar','bartend','mixologist','cocktail','barista'],warehouse:['warehouse','picker','packer','forklift','logistics','dispatch','stock'],office:['office','admin','administrator','reception','data entry','assistant','clerical'],retail:['retail','sales assistant','shop','cashier','merchandiser'],event:['event','festival','steward','ticket','usher','crew'],clean:['clean','housekeep','janitor','caretaker']};return (terms[type]||[type]).some(term=>title.includes(term));}))&&(roleFilters.length===0||roleFilters.includes(s.title))&&(minHourlyRate===''||hourly>=Number(minHourlyRate))&&(minTotalShiftPay===''||hourly*Math.max(0,(new Date(s.ends_at)-new Date(s.starts_at))/3600000)>=Number(minTotalShiftPay))&&distance;}).sort((a,b)=>{const totalPay=shift=>Number(shift.hourly_pay||0)*Math.max(0,(new Date(shift.ends_at)-new Date(shift.starts_at))/3600000);return shiftRateSort==='highest'?totalPay(b)-totalPay(a):shiftRateSort==='lowest'?totalPay(a)-totalPay(b):0;});
 return <div className={`${user?.role==='worker'?'app worker':user?.role==='employer'?'app employer':'app'} ${!user&&['home','register','login','chooseRole'].includes(page)?'auth-layout':''}`}><aside className="sidebar"><a className="brand" onClick={()=>navigateTo('home')}>hyrz</a>{!user&&<p className="tag">Flexible Work.<br/>Reliable Staffing.</p>}{user&&user.role!=='employer'&&<nav>{(user.role==='admin'?[['admin','Dashboard'],['account','My account']]:[['dashboard','Dashboard'],['account','My account']]).map(([id,label])=><button key={id} className={page===id?'selected':''} onClick={()=>navigateTo(id)}>{label}</button>)}</nav>}<div className="sidebottom">{user?<button onClick={logout}>Sign out</button>:<button onClick={()=>navigateTo('login')}>Sign in</button>}</div></aside>
 <main><header className={user?.role==='worker'?'worker-page-header':''}><div>{user?.role==='worker'&&page==='dashboard'&&<span className="eyebrow">YOUR PERSONAL WORKSPACE</span>}{user?.role==='employer'&&<span className="eyebrow">EMPLOYER WORKSPACE</span>}{!user&&<span className="eyebrow">UK FLEXIBLE STAFFING</span>}{user?.role==='worker'&&page==='dashboard'?<h1>Hello, {user.first_name||'there'}</h1>:<h1>{!user?'Find work that works for you':page==='account'?`Hello, ${user.first_name||'there'}` :page==='jobs'?'Find shifts':page==='post'?'Publish a shift':page==='admin'?'Dashboard':page==='workchats'&&user?.role==='employer'?'Workchat':page==='employerInbox'?'Inbox':page==='employerShifts'?'Shifts':page[0].toUpperCase()+page.slice(1)}</h1>}{user?.role==='worker'&&page==='dashboard'&&<p className="worker-greeting-subtitle">Your shifts, messages and work preferences — all in one place.</p>}</div>{user?.role==='worker'&&<button className="secondary worker-signout" onClick={logout}>Sign out</button>}{user?.role==='employer'&&<button className="secondary employer-signout" onClick={logout}>Sign out</button>}</header>{user&&['worker','employer'].includes(user.role)&&!['dashboard','jobs','contact','account','workchats'].includes(page)&&<div className="worker-subsection-toolbar"><button type="button" className="worker-back-button" onClick={goBack}>← Back</button></div>}
 
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
<h2>Flexible work.<br/><em>Reliable staffing.</em></h2>
<button className="primary" onClick={()=>navigateTo('chooseRole')}>Get started</button>
<p>Already registered? <button className="textbutton" onClick={()=>navigateTo('login')}>Sign in</button></p>
</div></section>}
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
   
 </section>}
 {user?.role==='employer'&&page==='employerShifts'&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">PLAN YOUR WORKFORCE</span><h2>Shifts and applicants</h2><p>Create shifts or review people who have applied.</p></div><button className="primary" onClick={()=>navigateTo('post')}>+ Post a shift</button></div><div className="employer-section-actions"><button className="secondary" onClick={()=>navigateTo('applications')}>Review applicants</button><button className="secondary" onClick={()=>navigateTo('post')}>Create a shift</button></div><ShiftList shifts={shifts.filter(s=>Number(s.employer_id)===Number(user.id)||Number(s.created_by)===Number(user.id))} role={user.role} apply={apply}/><p className="muted">Calendar copying across multiple dates, six-week scheduling, applicant ratings/experience filters and automatic approval criteria are not connected yet.</p></section>}
 {user?.role==='employer'&&page==='favourites'&&<section className="panel"><span className="eyebrow">YOUR TRUSTED TEAM</span><h2>Favourite workers</h2><p>Keep the workers you trust close and make it easier to invite them to future shifts.</p><div className="empty-state">Your favourite workers will appear here.</div><p className="muted">Worker search, add/remove favourites, past-shift shortcuts and favourite-based auto-approval are not connected yet.</p></section>}
 {user?.role==='employer'&&page==='funds'&&<section className="panel"><span className="eyebrow">STAFFING BALANCE</span><h2>Funds</h2><p>Keep track of the funds you intend to use for upcoming shifts.</p><div className="employer-funds-summary"><small>AVAILABLE BALANCE</small><strong>£0.00</strong><p>No funds account is connected yet.</p></div><button className="primary" disabled>Add funds (coming next)</button><p className="muted">Deposits, committed balances, refunds and cancellation charges must be implemented and tested before funds can be added or held.</p></section>}
 {user?.role==='employer'&&page==='employerInbox'&&<section className="panel"><span className="eyebrow">MESSAGES</span><h2>Inbox</h2><p>Keep worker conversations and hyrz admin support in one place.</p><div className="employer-section-actions"><button className="secondary" onClick={()=>navigateTo('contact')}>Contact hyrz support</button></div><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/><p className="muted">Employer/worker conversation filters and email alerts for every new inbox message still need their dedicated messaging workflow.</p></section>}
 {user?.role==='employer'&&page==='contact'&&<section className="panel employer-contact" style={{width:'100%',maxWidth:'900px',boxSizing:'border-box',margin:'0 auto',textAlign:'center'}}><span className="eyebrow">WE'RE HERE TO HELP</span><h2>Contact hyrz</h2><p style={{maxWidth:'680px',margin:'0 auto 1.25rem'}}>You can contact the hyrz support team here or in your inbox section with messages relating to an enquiry, a complaint or a checkout dispute. When you send a message, hyrz admins will receive both an email and an in-app notification so they can review it. We'll respond as soon as possible.</p><div style={{maxWidth:'540px',width:'100%',margin:'0 auto',textAlign:'left'}}><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/></div></section>}

 {user?.role==='worker'&&page==='dashboard'&&<><section className="stats worker-dashboard-stats">{[['checkouts','OPEN CHECKOUTS',checkouts.filter(c=>!['approved','paid','completed'].includes(String(c.status||'').toLowerCase())).length],['notifications','NOTIFICATIONS',0],['inbox','INBOX',0]].map(([id,label,count])=><button type="button" key={id} className="stat worker-dashboard-stat" onClick={()=>navigateTo(id)}><small>{label}</small><strong>{count}</strong><span>Open section →</span></button>)}</section><section className="worker-section-nav panel"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Dashboard sections</h2></div><div className="worker-section-links">{[['inbox','Inbox'],['checkouts','Checkouts'],['invoices','Invoices'],['availability','Availability'],['favourites','Favourites'],['complaints','Complaints'],['timetable','Timetable'],['notifications','Notifications']].map(([id,label])=><button key={id} className="secondary" onClick={()=>navigateTo(id)}>{label}</button>)}</div></section></>}
 {user&&user.role==='worker'&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='dashboard'&&<></>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='jobs'&&<section className="panel find-shifts-panel">
  <div className="find-shifts-heading"><span className="eyebrow">OPPORTUNITIES</span><h2>Find your next shift</h2><p>Choose dates to show only shifts available on those days.</p></div>
  <div className="rolling-shift-calendar"><div className="rolling-calendar-heading"><strong>Next 6 weeks</strong><button type="button" className="calendar-clear" onClick={()=>setSelectedShiftDates([])}>Show all</button></div><div className="rolling-calendar-days">{Array.from({length:42},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return {d,key};}).map(({d,key})=><button type="button" key={key} className={"rolling-calendar-day"+(selectedShiftDates.includes(key)?" active":"")} aria-pressed={selectedShiftDates.includes(key)} onClick={()=>setSelectedShiftDates(current=>current.length===1&&current[0]===key?[]:[key])}><small>{d.toLocaleDateString('en-GB',{weekday:'short'})}</small><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('en-GB',{month:'short'})}</span></button>)}</div></div>
  <div className="find-shifts-search"><input className="search" placeholder="Search role, employer or location" value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" className="secondary" onClick={()=>setShowShiftFilters(!showShiftFilters)}>Filters</button></div>
  {showShiftFilters&&<div className="shift-filters"><div className="shift-type-multi-filter"><label className="shift-type-filter-label">Shift types</label><button type="button" className="shift-type-picker-toggle" aria-expanded={shiftTypePickerOpen} onClick={()=>setShiftTypePickerOpen(v=>!v)}>{shiftTypeFilters.length===0?"All types":shiftTypeFilters.length+" selected"} <span>{shiftTypePickerOpen?"▴":"▾"}</span></button>{shiftTypeFilters.length>0&&<button type="button" className="role-clear-button shift-type-clear-button" onClick={()=>setShiftTypeFilters([])}>Clear selected shift types</button>}{shiftTypePickerOpen&&<div className="shift-type-picker-panel"><div className="shift-type-picker-options">{[["hospitality","Hospitality"],["bar","Bar work"],["warehouse","Warehouse"],["office","Office"],["retail","Retail"],["event","Events & festivals"],["clean","Cleaning"]].map(([value,label])=><label key={value} className="shift-type-picker-option"><input type="checkbox" checked={shiftTypeFilters.includes(value)} onChange={e=>setShiftTypeFilters(current=>e.target.checked?[...current,value]:current.filter(x=>x!==value))}/><span>{label}</span></label>)}</div><div className="shift-type-picker-footer"><button type="button" onClick={()=>setShiftTypeFilters([])}>Clear</button><button type="button" onClick={()=>setShiftTypePickerOpen(false)}>Done</button></div></div>}</div><label>Minimum hourly rate (£)<input type="number" min="8.00" step="0.50" value={minHourlyRate} onChange={e=>setMinHourlyRate(e.target.value===""?"8.00":String(Math.max(8,Number(e.target.value)||8)))}/></label><label>Minimum total shift pay (£)<input type="number" min="8.00" step="1.00" value={minTotalShiftPay} onChange={e=>setMinTotalShiftPay(e.target.value===""?"8.00":String(Math.max(8,Number(e.target.value)||8)))}/></label><div className="shift-date-range"><span className="shift-date-range-label">Dates</span><div className="shift-date-range-inputs"><label>From<input aria-label="From date" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>Until<input aria-label="Until date" type="date" min={dateFrom||undefined} value={dateUntil} onChange={e=>setDateUntil(e.target.value)}/></label></div></div><label>Shift start times (starts at or after)<select aria-label="Shift start times — starts at or after the selected time" value={shiftStartAfter} onChange={e=>setShiftStartAfter(e.target.value)}><option value="">Anytime</option>{Array.from({length:96},(_,index)=>{const minute=index*15;const time=`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;return <option key={time} value={time}>{time}</option>})}</select></label><label>Shift end times (finishes by)<select aria-label="Shift end times — finishes by the selected time" value={shiftEndBefore} onChange={e=>setShiftEndBefore(e.target.value)}><option value="">Anytime</option><optgroup label="Same day">{Array.from({length:96},(_,index)=>{const minute=index*15;const time=`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;return <option key={time} value={time}>{time}</option>})}</optgroup><optgroup label="Next day">{Array.from({length:96},(_,index)=>{const minute=index*15;const time=`nextday:${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;return <option key={time} value={time}>Next day {time.slice(8)}</option>})}</optgroup></select></label><div className="role-multi-filter"><div className="role-multi-filter-heading"><span>Roles</span><button type="button" className="role-picker-toggle" aria-expanded={rolePickerOpen} onClick={()=>setRolePickerOpen(!rolePickerOpen)}>{roleFilters.length===0?'All roles':roleFilters.length+' selected'} <span>{rolePickerOpen?'▴':'▾'}</span></button></div><small className="role-filter-hint">Choose one or more roles. No selection shows every role.</small>{roleFilters.length>0&&<button type="button" className="role-clear-button" onClick={()=>setRoleFilters([])}>Clear selected roles</button>}{rolePickerOpen&&<div className="role-picker-panel"><input type="search" aria-label="Search job roles" placeholder="Search 609 job roles…" value={roleSearch} onChange={e=>setRoleSearch(e.target.value)}/><div className="role-picker-options">{JOB_ROLE_GROUPS.map(([group,roles])=>{const matches=roles.filter(roleName=>roleName.toLowerCase().includes(roleSearch.trim().toLowerCase()));if(!matches.length)return null;return <fieldset key={group} className="role-picker-group"><legend>{group}</legend>{matches.map(roleName=><label key={roleName} className="role-picker-option"><input type="checkbox" checked={roleFilters.includes(roleName)} onChange={e=>setRoleFilters(current=>e.target.checked?[...current,roleName]:current.filter(name=>name!==roleName))}/><span>{roleName}</span></label>)}</fieldset>})}</div><div className="role-picker-footer"><span>{roleFilters.length} selected</span><button type="button" onClick={()=>setRolePickerOpen(false)}>Done</button></div></div>}</div><label>Maximum distance (miles)<input type="number" min="1" step="1" value={maxDistance} onChange={e=>setMaxDistance(e.target.value===""?"1":String(Math.max(1,Math.floor(Number(e.target.value)||1))))}/></label></div>}
  {((search.trim()!=='')||(shiftTypeFilters.length>0||Number(minHourlyRate)>8||Number(minTotalShiftPay)>20||shiftRateSort!==''||dateFrom!==''||dateUntil!==''||shiftStartAfter!==''||shiftEndBefore!==''||roleFilters.length>0||Number(maxDistance)!==10))&&<button type="button" className="clear-all-filters" onClick={()=>{setSearch('');setSelectedShiftDates([]);setShiftTypeFilters([]);setMinHourlyRate('8.00');setMinTotalShiftPay('20.00');setShiftRateSort('');setDateFrom('');setDateUntil('');setShiftStartAfter('');setShiftEndBefore('');setRoleFilters([]);setRoleSearch('');setMaxDistance('10');setRolePickerOpen(false);setShiftTypePickerOpen(false);}}>Clear all filters</button>}
  {user.role==='worker'&&<div className="worker-section-links job-tabs">{[['available','Available shifts'],['applied','Applied shifts'],['upcoming','Upcoming shifts'],['rejected','Rejected shifts'],['completed','Completed shifts']].map(([id,label])=><button type="button" key={id} className={jobFilter===id?'selected':''} onClick={()=>setJobFilter(id)}>{label}</button>)}</div>}
  {user.role==='worker'&&jobFilter!=='available'?<ApplicationShiftList applications={applications.filter(app=>jobFilter==='applied'?app.status==='pending':jobFilter==='upcoming'?app.status==='approved':jobFilter==='rejected'?app.status==='rejected':jobFilter==='completed'?app.status==='completed':false)} empty={'No '+jobFilter+' shifts yet.'} cancel={async id=>{if(window.confirm('Cancel this shift application?'))await action(async()=>{await request(`/applications/${id}/cancel`,{method:'POST',body:'{}'});await load();setNotice('Application cancelled')})}}/>:<ShiftList shifts={visibleShifts} role={user.role} apply={apply} selectedDate={selectedShiftDates[0]||''}/>}
 </section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='post'&&user.role==='employer'&&<section className="panel"><h2>Shift details</h2><form onSubmit={createShift} className="formgrid"><label>Shift type<select required value={shift.shiftType} onChange={e=>{localStorage.setItem('hyrz_default_shift_type',e.target.value);setShift({...shift,shiftType:e.target.value});}}><option value="hospitality">Hospitality</option><option value="warehouse">Warehouse &amp; logistics</option><option value="retail">Retail</option><option value="events">Events</option><option value="office">Office &amp; administration</option><option value="cleaning">Cleaning</option><option value="care">Care</option><option value="construction">Construction</option><option value="driving">Driving &amp; delivery</option><option value="other">Other</option></select></label><label>Job role<select required value={shift.title} onChange={e=>setShift({...shift,title:e.target.value})}><option value="">Choose a role</option>{JOB_ROLE_GROUPS.map(([group,roles])=><optgroup key={group} label={group}>{roles.map(roleName=><option key={roleName} value={roleName}>{roleName}</option>)}</optgroup>)}</select></label><label>Start time<select required value={postStartTime} onChange={e=>setPostStartTime(e.target.value)}>{Array.from({length:96},(_,i)=>{const t=String(Math.floor(i*15/60)).padStart(2,'0')+':'+String(i*15%60).padStart(2,'0');return <option key={t} value={t}>{t}</option>})}</select></label><label>End time<select required value={postEndTime} onChange={e=>setPostEndTime(e.target.value)}>{Array.from({length:96},(_,i)=>{const t=String(Math.floor(i*15/60)).padStart(2,'0')+':'+String(i*15%60).padStart(2,'0');return <option key={t} value={t}>{t}</option>})}</select></label><label>Hourly pay (£)<input required type="number" min="8" step="0.01" value={shift.hourlyPay} onChange={e=>setShift({...shift,hourlyPay:e.target.value})}/></label><label>Number of workers<input required type="number" min="1" step="1" value={shift.slots} onChange={e=>setShift({...shift,slots:e.target.value})}/></label><label className="wide">Description<textarea value={shift.description} onChange={e=>setShift({...shift,description:e.target.value})}/></label><div className="wide"><h3>Applicant requirements</h3><p>List the requirements applicants must confirm when they apply.</p>{shiftRequirements.map((req,i)=><div key={i} style={{display:'flex',gap:'.5rem',marginBottom:'.5rem'}}><input aria-label={'Requirement '+(i+1)} maxLength="250" placeholder={'Requirement '+(i+1)} value={req} onChange={e=>setShiftRequirements(cur=>cur.map((v,j)=>i===j?e.target.value:v))}/><button type="button" className="secondary" disabled={shiftRequirements.length===1} onClick={()=>setShiftRequirements(cur=>cur.filter((_,j)=>j!==i))}>Remove</button></div>)}<button type="button" className="secondary" disabled={shiftRequirements.length>=10} onClick={()=>setShiftRequirements(cur=>[...cur,''])}>Add requirement ({shiftRequirements.length}/10)</button></div><div className="wide"><h3>Select shift dates</h3><p>Select one or more dates. A separate shift will be published for each selected date using the timings above.</p><div className="rolling-shift-calendar"><div className="rolling-calendar-heading"><strong>Next 6 weeks</strong><span>{postDates.length?postDates.length+' selected':'Choose dates'}</span></div><div className="rolling-calendar-days">{Array.from({length:42},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return <button type="button" key={key} aria-pressed={postDates.includes(key)} className={'rolling-calendar-day'+(postDates.includes(key)?' selected':'')} onClick={()=>setPostDates(cur=>cur.includes(key)?cur.filter(x=>x!==key):[...cur,key])}><small>{d.toLocaleDateString('en-GB',{weekday:'short'})}</small><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('en-GB',{month:'short'})}</span></button>})}</div></div></div><button className="primary wide" disabled={busy||!postDates.length}>Publish shift{postDates.length>1?'s ('+postDates.length+')':''}</button></form></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='applications'&&<section className="panel"><h2>Applications</h2><DataList items={applications} empty="No applications yet." render={a=><div className="row" key={a.id}><div><b>{a.title}</b><small>{a.business_name||`${a.first_name||''} ${a.last_name||''}`} · {a.starts_at}</small></div><span className={`status ${a.status}`}>{a.status}</span>{user.role==='employer'&&a.status==='pending'&&<div className="actions"><button onClick={()=>updateApplication(a.id,'approved')}>Approve</button><button onClick={()=>updateApplication(a.id,'rejected')}>Reject</button></div>}</div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='checkouts'&&<section className="panel"><h2>Timesheets &amp; checkouts</h2><div className="job-tabs">{[['all','All'],['open','Open checkouts'],['disputed','Disputed checkouts'],['approved','Approved checkouts']].map(([id,label])=><button type="button" key={id} className={checkoutFilter===id?'active':''} onClick={()=>setCheckoutFilter(id)}>{label}</button>)}</div><DataList items={checkouts.filter(c=>checkoutFilter==='all'?true:checkoutFilter==='open'?['open','submitted','pending'].includes(String(c.status||'').toLowerCase()):String(c.status||'').toLowerCase()===checkoutFilter)} empty="No checkouts match this section." render={checkout=><div className="row" key={checkout.id}><div><b>{checkout.title||('Checkout #'+checkout.id)}</b><small>{checkout.actual_start} – {checkout.actual_end} · Gross {money(checkout.gross_pay)} · Fee {money(checkout.platform_fee)}</small></div><span className={'status '+checkout.status}>{checkout.status}</span>{['employer','admin'].includes(user.role)&&checkout.status==='submitted'&&<button type="button" onClick={()=>action(async()=>{await request('/checkouts/'+checkout.id+'/review',{method:'PATCH',body:JSON.stringify({status:'approved'})});await load();})}>Approve</button>}{user.role==='employer'&&['submitted','disputed'].includes(checkout.status)&&<CounterOfferForm checkout={checkout} action={action} busy={busy} onDone={load} setNotice={setNotice}/>}</div>}/></section>}
 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='invoices'&&<section className="panel"><h2>Invoices</h2><div className="job-tabs">{[['unpaid','Due invoices'],['paid','Paid invoices']].map(([id,label])=><button type="button" key={id} className={invoiceFilter===id?'active':''} onClick={()=>setInvoiceFilter(id)}>{label}</button>)}</div><DataList items={invoices.filter(i=>invoiceFilter==='paid'?String(i.status||'').toLowerCase()==='paid':String(i.status||'').toLowerCase()!=='paid')} empty={invoiceFilter==='unpaid'?'No due invoices.':'No paid invoices.'} render={i=><div className="row" key={i.id}><div><b>Invoice #{i.id} · {i.title}</b><small>Due {i.due_at} · Platform fee {money(i.platform_fee)}</small></div><strong>{money(i.total)}</strong><span className={`status ${i.status}`}>{i.status}</span></div>}/></section>}

 {user?.role==='worker'&&page==='inbox'&&<WorkerInbox user={user} action={action} busy={busy} setNotice={setNotice} setError={setError} goBack={goBack}/>}
 {user?.role==='worker'&&page==='availability'&&<WorkerAvailability action={action} busy={busy} setNotice={setNotice} setError={setError} navigateTo={navigateTo}/>}
 {user?.role==='worker'&&page==='favourites'&&<WorkerEmployerFavourites navigateTo={navigateTo} action={action} busy={busy} setError={setError} setNotice={setNotice}/>}
 {user?.role==='worker'&&page==='complaints'&&<section className="panel worker-complaints-panel" style={{textAlign:'center',width:'100%',boxSizing:'border-box'}}><button className="textbutton" style={{display:'block',margin:'0 auto 1rem'}} onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2 style={{textAlign:'center'}}>Complaints</h2><p style={{textAlign:'center'}}>Report concerns about a client, a person or conditions at a work site. Your message is sent to hyrz support.</p><div style={{maxWidth:'540px',width:'100%',margin:'0 auto',textAlign:'left'}}><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/></div></section>}
 {user?.role==='worker'&&page==='timetable'&&<WorkerTimetable applications={applications} navigateTo={navigateTo}/>}
 {user?.role==='worker'&&page==='notifications'&&<WorkerNotifications navigateTo={navigateTo} setError={setError} setNotice={setNotice}/>}
 {user?.role==='worker'&&page==='workchats'&&<section className="panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Workchats</h2><p>Group conversations for employers who have added you to their favourites will appear here.</p><div className="empty-state">No workchats available yet.</div></section>}
 {user?.role==='worker'&&page==='contact'&&<SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/>}

 {user&&page==='account'&&<AccountSettings user={user} setUser={setUser} action={action} busy={busy} setNotice={setNotice}/>}

 {user&&(onboarding?.canAccessPlatform||user.role==='admin')&&page==='admin'&&user.role==='admin'&&<AdminConsole user={user} action={action} setNotice={setNotice} setError={setError} busy={busy}/>}

 
  </main>{user?.role==='worker'&&<nav className="worker-bottom-nav" aria-label="Worker navigation">{[['dashboard','Dashboard','⌂'],['jobs','Jobs','⌕'],['account','Profile','◉'],['workchats','Workchats','☏'],['contact','Contact','✉']].map(([id,label,icon])=><button key={id} className={page===id?'active':''} onClick={()=>{setPageHistory([]);setPage(id);}}><span>{icon}</span><small>{label}</small></button>)}</nav>}{user?.role==='employer'&&<nav className="employer-bottom-nav" aria-label="Employer navigation">{[['dashboard','Dashboard','⌂'],['account','Profile','◉'],['workchats','Workchat','☏'],['contact','Contact','✉']].map(([id,label,icon])=><button key={id} className={page===id?'active':''} onClick={()=>{setPageHistory([]);setPage(id);}}><span>{icon}</span><small>{label}</small></button>)}</nav>}</div>
}
function AccountSettings({user,setUser,action,busy,setNotice}) {
 const [firstName,setFirstName]=useState(user.first_name||(user.role==='admin'?'Simson':''));
 const [lastName,setLastName]=useState(user.last_name||(user.role==='admin'?'Hannawell':''));
 const [showPasswordEditor,setShowPasswordEditor]=useState(false);
 const [currentPassword,setCurrentPassword]=useState('');
 const [newPassword,setNewPassword]=useState('');
 const [confirmNewPassword,setConfirmNewPassword]=useState('');
 const [profilePicture,setProfilePicture]=useState(user.profile_picture||'');
 const [email,setEmail]=useState(user.email||'');
 const [addressLine1,setAddressLine1]=useState(user.address_line_1||'');
 const [addressCity,setAddressCity]=useState(user.address_city||'');
 const [addressPostcode,setAddressPostcode]=useState(user.address_postcode||'');
 const [showEmailEditor,setShowEmailEditor]=useState(false);
 const [showAddressEditor,setShowAddressEditor]=useState(false);
 const [verification,setVerification]=useState(null);
 const [referralCopied,setReferralCopied]=useState(false);
 const referralLink=typeof window!=='undefined'?window.location.origin+'/?ref='+encodeURIComponent(user.id):'';
 async function copyReferralLink(){try{await navigator.clipboard.writeText(referralLink);setReferralCopied(true);window.setTimeout(()=>setReferralCopied(false),2200);}catch{const field=document.createElement('textarea');field.value=referralLink;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();const copied=document.execCommand('copy');field.remove();if(copied){setReferralCopied(true);window.setTimeout(()=>setReferralCopied(false),2200);}}}
 useEffect(()=>{request('/onboarding/status').then(r=>setVerification(r.onboarding)).catch(()=>{});},[]);
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
  {user.role==='worker'&&<><hr/><section className="referral-link-section" style={{border:"1px solid var(--border,#34382f)",borderRadius:"12px",padding:"1.25rem",margin:"1.25rem 0",background:"rgba(255,255,255,.02)"}}><h2 style={{marginTop:0,marginBottom:".4rem"}}>Referral link</h2><p style={{marginTop:0,marginBottom:"1rem"}}>Invite friends to join hyrz using your personal referral link.</p><div className="referral-link-copy-row" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:".6rem",alignItems:"stretch"}}><input aria-label="Your referral link" type="text" readOnly value={referralLink} style={{minWidth:0,width:"100%",boxSizing:"border-box",fontSize:".9rem"}}/><button type="button" className="primary" style={{whiteSpace:"nowrap",minWidth:"100px"}} onClick={copyReferralLink}>{referralCopied?"Copied!":"Copy link"}</button></div>{referralCopied&&<p role="status" style={{margin:".45rem 0 0",fontSize:".85rem"}}>Referral link copied to clipboard.</p>}<details className="referral-commission-info" style={{marginTop:"1rem",borderTop:"1px solid var(--border,#34382f)",paddingTop:".75rem"}}><summary aria-label="How referral commission works" title="How referral commission works" style={{cursor:"pointer",display:"flex",alignItems:"center",gap:".5rem",fontWeight:600,listStyle:"none"}}><span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:"22px",height:"22px",borderRadius:"50%",border:"1px solid currentColor",fontSize:".8rem"}}>?</span> How commissions work</summary><p style={{marginBottom:0,lineHeight:1.55}}>You can earn <strong>£20 per week</strong> for each employee you refer who works a full week. A week worked is defined as <strong>40 hours worked</strong>.</p></details></section></>}
  <hr/>
  <div className="account-password-heading"><h2>Personal details</h2></div>
  <label>First name<input type="text" value={user.first_name||(user.role==='admin'?'Simson':'')} readOnly aria-readonly="true"/></label>
  <label>Last name<input type="text" value={user.last_name||(user.role==='admin'?'Hannawell':'')} readOnly aria-readonly="true"/></label>
  <div className="account-password-heading"><h3>Email address</h3><button type="button" className="password-edit-button" onClick={()=>{setEmail(user.email||'');setShowEmailEditor(v=>!v);}}>{showEmailEditor?'Cancel':'✎ Edit'}</button></div>
  {!showEmailEditor?<p className="account-readonly-value">{user.email||'Not provided'} · {user.email_verified_at?'Verified':'Verification may be required'}</p>:<form className="account-inline-editor" onSubmit={e=>{e.preventDefault();action(async()=>{const result=await request('/auth/profile',{method:'PATCH',body:JSON.stringify({email})});setUser(result.user);setEmail(result.user.email);setShowEmailEditor(false);setNotice(result.emailVerificationRequired?'Email updated. You must verify the new address before accessing restricted features.':'Email updated.');});}}><label>New email address<input type="email" required maxLength="254" value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="secondary" disabled={busy}>Save email</button><small>Changing your email will require you to verify the new address.</small></form>}
  <hr/>
  <div className="account-password-heading"><h2>Address</h2><button type="button" className="password-edit-button" onClick={()=>{setAddressLine1(user.address_line_1||'');setAddressCity(user.address_city||'');setAddressPostcode(user.address_postcode||'');setShowAddressEditor(v=>!v);}}>{showAddressEditor?'Cancel':'✎ Edit'}</button></div>
  {!showAddressEditor?<div className="account-readonly-value"><p>{user.address_line_1||'Address not added'}</p><p>{[user.address_city,user.address_postcode].filter(Boolean).join(', ')}</p></div>:<form className="account-inline-editor" onSubmit={e=>{e.preventDefault();action(async()=>{const result=await request('/auth/profile',{method:'PATCH',body:JSON.stringify({addressLine1,addressCity,addressPostcode})});setUser(result.user);setShowAddressEditor(false);setNotice('Your address has been saved.');});}}><label>Address line<input autoComplete="street-address" maxLength="255" value={addressLine1} onChange={e=>setAddressLine1(e.target.value)}/></label><div className="grid2"><label>Town or city<input autoComplete="address-level2" maxLength="120" value={addressCity} onChange={e=>setAddressCity(e.target.value)}/></label><label>Postcode<input autoComplete="postal-code" maxLength="20" value={addressPostcode} onChange={e=>setAddressPostcode(e.target.value.toUpperCase())}/></label></div><button className="secondary" disabled={busy}>Save address</button></form>}
  <hr/>
  <div className="account-password-heading"><h2>Verification details</h2><span className="muted">Read-only</span></div>
  <div className="account-verification-details">
   <div><strong>Identity verification</strong><span>{verification?.identityStatus||'Status unavailable'}</span></div>
   {user.role==='worker'&&<div><strong>Right-to-work check</strong><span>{verification?.rightToWorkStatus||'Status unavailable'}</span></div>}
   {user.role==='employer'&&<div><strong>Company verification</strong><span>{verification?.companyStatus||'Status unavailable'}</span></div>}
   {user.role==='worker'&&<><div><strong>National Insurance / worker permit number</strong><span>Identifier is stored as a one-way security hash and cannot be displayed again.</span></div><div><strong>Identity document number</strong><span>No retrievable document number is currently stored on your profile.</span></div><div><strong>Uploaded identity / right-to-work documents</strong><span>Document upload and secure document storage are not yet connected.</span></div></>}
   {user.role==='employer'&&<div><strong>Uploaded verification documents</strong><span>Document upload and secure document storage are not yet connected.</span></div>}
  </div>
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

function ApplicationShiftList({applications,empty,cancel}){return <DataList items={applications} empty={empty} render={app=><article className="shiftrow shift-card application-shift-card" key={app.id}><div className="shift-employer-avatar"><span>{(app.business_name||'H').trim().charAt(0).toUpperCase()}</span></div><div className="shiftmain"><b>{app.title}</b><small className="shift-business">{app.business_name||'Employer'} · {app.location||'Location to be confirmed'}</small><div className="shift-schedule"><div className="shift-schedule-row"><span className="shift-meta-label">DATE</span><strong>{app.starts_at?new Date(app.starts_at).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'}):'To be confirmed'}</strong></div><div className="shift-schedule-row"><span className="shift-meta-label">TIME</span><strong>{app.starts_at&&app.ends_at?new Date(app.starts_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+' – '+new Date(app.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'To be confirmed'}</strong></div><div className="shift-schedule-row"><span className="shift-meta-label">TOTAL SHIFT RATE</span><strong>{app.hourly_pay!=null&&app.starts_at&&app.ends_at?money(Number(app.hourly_pay)*Math.max(0,(new Date(app.ends_at)-new Date(app.starts_at))/3600000)):'—'}</strong></div></div></div><div className="shiftpay"><span className="shift-meta-label">HOURLY RATE</span><strong>{app.hourly_pay!=null?<>{money(app.hourly_pay)}<small>/hr</small></>:'—'}</strong><span className={'status '+app.status}>{app.status}</span>{app.status==='pending'&&<button type="button" className="secondary" onClick={()=>cancel(app.id)}>Cancel application</button>}</div></article>}/>}

function ShiftList({shifts,role,apply,selectedDate}){return <DataList items={shifts} empty="No open shifts found for these filters." render={s=><article className="shiftrow shift-card" key={s.id}><div className="shift-employer-avatar">{s.employer_profile_picture?<img src={s.employer_profile_picture} alt={`${s.business_name||'Employer'} profile`}/>:<span aria-label="No profile picture uploaded" title="No profile picture uploaded">{(s.business_name||'H').trim().charAt(0).toUpperCase()}</span>}</div><div className="shiftmain"><b>{s.title}</b><small className="shift-business">Company: {s.business_name||'Employer'}</small><small className="shift-business">Location: {s.location||'To be confirmed'}</small><div className="shift-schedule"><div className="shift-schedule-row"><span className="shift-meta-label">DATE</span><strong>{new Date(s.starts_at).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</strong></div><div className="shift-schedule-row"><span className="shift-meta-label">TIME</span><strong>{new Date(s.starts_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} – {new Date(s.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</strong></div><div className="shift-schedule-row"><span className="shift-meta-label">TOTAL SHIFT RATE</span><strong>{money(Number(s.hourly_pay||0)*Math.max(0,(new Date(s.ends_at)-new Date(s.starts_at))/3600000))}</strong></div></div></div><div className="shiftpay"><span className="shift-meta-label">HOURLY RATE</span><strong>{money(s.hourly_pay)}<small>/hr</small></strong>{role==='worker'&&<button onClick={()=>apply(s.id)}>Apply for shift ↗</button>}</div></article>}/>}
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

function WorkerTimetable({applications,navigateTo}) {
 const [selectedDate,setSelectedDate]=useState('');
 const today=new Date();today.setHours(0,0,0,0);
 const dates=Array.from({length:42},(_,i)=>{const d=new Date(today);d.setDate(today.getDate()+i);return d;});
 const keyFor=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const shifts=applications.filter(a=>['approved','accepted','confirmed'].includes(String(a.status||'').toLowerCase()));
 const shiftsByDate=shifts.reduce((acc,a)=>{const key=String(a.starts_at||'').slice(0,10);if(key){(acc[key]||(acc[key]=[])).push(a);}return acc;},{});
 const selectedShifts=shiftsByDate[selectedDate]||[];
 return <section className="panel worker-timetable-panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Your timetable</h2><p>Your next six weeks. Red dates have confirmed shifts; green dates are currently free.</p><div className="timetable-legend"><span><i className="timetable-legend-red"/> Confirmed shift</span><span><i className="timetable-legend-green"/> Free</span></div><div className="timetable-grid"><div className="timetable-weekdays">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><strong key={day}>{day}</strong>)}</div><div className="timetable-days">{dates.map(d=>{const key=keyFor(d),dayShifts=shiftsByDate[key]||[],occupied=dayShifts.length>0;return <button type="button" key={key} className={'timetable-day '+(occupied?'has-shift':'free-day')+(selectedDate===key?' selected':'')} aria-pressed={selectedDate===key} onClick={()=>setSelectedDate(key)}><small>{d.toLocaleDateString('en-GB',{month:'short'})}</small><strong>{d.getDate()}</strong>{occupied&&<span>{dayShifts.length} shift{dayShifts.length===1?'':'s'}</span>}</button>;})}</div></div>{selectedDate&&<section className="timetable-selected-shifts"><h3>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h3>{selectedShifts.length===0?<div className="empty-state">You're currently free on this date. No confirmed shifts are listed.</div>:selectedShifts.map(a=><article className="timetable-shift-card" key={a.id}><h4>{a.title||'Shift'}</h4><p><strong>Employer:</strong> {a.business_name||'Not provided'}</p><p><strong>Location:</strong> {a.location||'Not provided'}</p><p><strong>Time:</strong> {a.starts_at?new Date(a.starts_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'TBC'} – {a.ends_at?new Date(a.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'TBC'}</p>{a.hourly_pay!=null&&<p><strong>Hourly pay:</strong> £{Number(a.hourly_pay).toFixed(2)}</p>}<small>Status: {a.status}</small></article>)}</section>}</section>;
}

function WorkerEmployerFavourites({navigateTo,action,busy,setError,setNotice}) {
 const [tab,setTab]=useState('search');
 const [query,setQuery]=useState('');
 const [role,setRole]=useState('');
 const [location,setLocation]=useState('');
 const [results,setResults]=useState([]);
 const [favourites,setFavourites]=useState([]);
 const [myFavourites,setMyFavourites]=useState([]);
 const [loading,setLoading]=useState(false);
 async function loadSearch(past=false){setLoading(true);try{const params=new URLSearchParams();if(query.trim())params.set('q',query.trim());if(role.trim())params.set('role',role.trim());if(location.trim())params.set('location',location.trim());if(past)params.set('past','1');const r=await request('/worker/employers/search?'+params.toString());setResults(r.employers||[]);}catch(e){setError(e.message);}finally{setLoading(false);}}
 async function loadFavourites(){setLoading(true);try{const r=await request('/worker/employers/favourited-me');setFavourites(r.employers||[]);}catch(e){setError(e.message);}finally{setLoading(false);}}
 async function loadMyFavourites(){setLoading(true);try{const r=await request('/worker/employers/favourites');setMyFavourites(r.employers||[]);}catch(e){setError(e.message);}finally{setLoading(false);}}
 useEffect(()=>{if(tab==='search')loadSearch(false);else if(tab==='previous')loadSearch(true);else if(tab==='mine')loadMyFavourites();else loadFavourites();},[tab]);
 useEffect(()=>{if(tab!=='search')return;const timer=setTimeout(()=>loadSearch(false),250);return()=>clearTimeout(timer);},[query,role,location,tab]);
 async function toggleFavourite(employer){await action(async()=>{if(employer.isFavourite)await request('/worker/employers/'+employer.business_id+'/favourite',{method:'DELETE'});else await request('/worker/employers/'+employer.business_id+'/favourite',{method:'POST',body:JSON.stringify({})});setNotice(employer.isFavourite?'Employer removed from your favourites.':'Employer added to your favourites.');if(tab==='favourites')await loadFavourites();else if(tab==='mine')await loadMyFavourites();else await loadSearch(tab==='previous');});}
 const items=tab==='favourites'?favourites:tab==='mine'?myFavourites:results;
 return <section className="panel worker-employer-favourites"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Favourites</h2><p>Find employers, revisit previous employers, and see which employers have added you to their favourites.</p><div className="job-tabs">{[['search','Search employer'],['previous','Previous employers'],['mine','My favourites'],['favourites','On their favourites']].map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
 {tab==='search'&&<form className="employer-search-filters" onSubmit={e=>{e.preventDefault();loadSearch(false);}}><label>Company name<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search company name"/></label><label>Available or past role<input value={role} onChange={e=>setRole(e.target.value)} placeholder="e.g. Bartender, Warehouse Operative"/></label><label>Location<input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Town, city or postcode"/></label><button className="primary" disabled={loading}>Search employers</button></form>}
 {tab==='previous'&&<div><p className="muted">Employers you've applied to for shifts are shown here. Where shift history is available, roles from those employers are included.</p><form className="employer-search-filters" onSubmit={e=>{e.preventDefault();loadSearch(true);}}><label>Company name<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter previous employers"/></label><label>Role worked or applied for<input value={role} onChange={e=>setRole(e.target.value)} placeholder="Filter by role"/></label><label>Location<input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Filter by location"/></label><button className="primary" disabled={loading}>Search previous employers</button></form></div>}
 {loading?<p className="muted">Searching employers…</p>:items.length===0?<div className="empty-state">{tab==='favourites'?'No employers have added you to their favourites yet.':tab==='mine'?'You haven’t added any employers to your favourites yet. Search for employers and add them here.':tab==='previous'?'No previous employers match those filters.':'No employers match those search filters.'}</div>:<div className="employer-favourite-results">{items.map(employer=><article className="shiftrow shift-card" key={employer.business_id}><div className="shift-employer-avatar">{(employer.profile_picture||employer.employer_profile_picture||employer.logo_url)?<img src={employer.profile_picture||employer.employer_profile_picture||employer.logo_url} alt={employer.company_name+' profile'} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:null}</div><div className="shiftmain"><b>{employer.company_name}</b><small className="shift-business">Company: {employer.company_name}</small><small className="shift-business">Location: {employer.company_location||'Location not provided'}</small><small className="shift-business">Roles available or previously listed: {employer.rolesAvailable?.length?employer.rolesAvailable.join(', '):'No roles listed yet'}</small>{employer.latest_shift&&<small className="shift-business">Most recent listed shift: {new Date(employer.latest_shift).toLocaleDateString('en-GB')}</small>}</div><div className="shiftpay"><button type="button" className={employer.isFavourite?'secondary':'primary'} disabled={busy} onClick={()=>toggleFavourite(employer)}>{employer.isFavourite?(tab==='mine'?'★ Remove from My favourites':'★ Remove favourite'):'☆ Add to favourites'}</button></div></article>)}</div>}
 </section>;
}

function WorkerAvailability({action,busy,setNotice,setError,navigateTo}) {
 const [tab,setTab]=useState('confirmed');
 const [dates,setDates]=useState([]);
 const [timings,setTimings]=useState({});
 const [minHourlyRate,setMinHourlyRate]=useState('8');
 const [minTotalPay,setMinTotalPay]=useState('20');
 const [maxDistance,setMaxDistance]=useState('10');
 const [roles,setRoles]=useState([]);
 const [shiftTypes,setShiftTypes]=useState([]);
 const [automatic,setAutomatic]=useState(false);
 const [confirmAuto,setConfirmAuto]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [startTime,setStartTime]=useState('09:00');
 const [endTime,setEndTime]=useState('17:00');
 const [rolesOpen,setRolesOpen]=useState(false);
 const [roleSearch,setRoleSearch]=useState('');
 const [typesOpen,setTypesOpen]=useState(false);
 const [employerMode,setEmployerMode]=useState('all');
 const [favouriteEmployers,setFavouriteEmployers]=useState([]);
 const [preferredEmployerIds,setPreferredEmployerIds]=useState([]);
 const [employersOpen,setEmployersOpen]=useState(false);
 const shiftTypeOptions=[['hospitality','Hospitality'],['bar','Bar work'],['warehouse','Warehouse'],['office','Office'],['retail','Retail'],['event','Events & festivals'],['clean','Cleaning'],['driving','Driving'],['other','Other']];
 useEffect(()=>{function closeDropdowns(event){if(!event.target.closest('.availability-collapsible.role-multi-filter'))setRolesOpen(false);if(!event.target.closest('.availability-collapsible.shift-type-multi-filter'))setTypesOpen(false);if(!event.target.closest('.availability-employer-preferences'))setEmployersOpen(false);}function closeOnEscape(event){if(event.key==='Escape'){setRolesOpen(false);setTypesOpen(false);setEmployersOpen(false);}}document.addEventListener('pointerdown',closeDropdowns);document.addEventListener('keydown',closeOnEscape);return()=>{document.removeEventListener('pointerdown',closeDropdowns);document.removeEventListener('keydown',closeOnEscape);};},[]);

 useEffect(()=>{Promise.all([request('/worker/availability'),request('/worker/employers/favourites')]).then(([r,f])=>{const d=r.availability||{};setTimings(d.timings||{});setMinHourlyRate(String(d.minHourlyRate??8));setMinTotalPay(String(d.minTotalPay??20));setMaxDistance(String(d.maxDistance??10));setRoles(d.roles||[]);setShiftTypes(d.shiftTypes||[]);setAutomatic(Boolean(d.automatic));setEmployerMode(d.employerMode||'all');setPreferredEmployerIds((d.preferredEmployerIds||[]).map(String));setFavouriteEmployers(f.employers||[]);setLoaded(true);}).catch(e=>{setError(e.message);setLoaded(true);});},[]);
 const calendar=Array.from({length:42},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return {d,key};});
 const savePayload={timings,minHourlyRate:Number(minHourlyRate),minTotalPay:Number(minTotalPay),maxDistance:Number(maxDistance),roles,shiftTypes,automatic,employerMode,preferredEmployerIds:preferredEmployerIds.map(Number).filter(Number.isFinite)};
 async function save(payload,success){if(payload.timings)setTimings(payload.timings);await action(async()=>{const result=await request('/worker/availability',{method:'PUT',body:JSON.stringify(payload)});const d=result.availability||payload;setTimings(d.timings||payload.timings||{});setAutomatic(Boolean(d.automatic));setNotice(success);});}
 // Preference controls save automatically; no separate Save button is needed.
 useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{request('/worker/availability',{method:'PUT',body:JSON.stringify(savePayload)}).catch(e=>setError(e.message));},500);return()=>clearTimeout(timer);},[loaded,minHourlyRate,minTotalPay,maxDistance,roles,shiftTypes,automatic,employerMode,preferredEmployerIds]);
 async function addTimings(){if(!dates.length){setError('Select at least one date on the calendar first.');return;}const untilEnd=endTime==='shift_end';const nextDay=endTime.startsWith('nextday:');const endClock=nextDay?endTime.slice(8):endTime;if(startTime!=='anytime'&&(!startTime||(!untilEnd&&!nextDay&&(!endClock||endClock==='anytime'||startTime>=endClock)))){setError('Choose a valid end time. For shifts ending after midnight, choose a Next day time.');return;}const next={...timings};dates.forEach(date=>next[date]={start:startTime==='anytime'?'anytime':startTime,end:untilEnd?'shift_end':endTime,confirmed:false,anytime:startTime==='anytime'});setTimings(next);setDates([]);setNotice('Availability selected. Confirm automatic matching to publish these dates.');}
 async function removeDate(date){const next={...timings};delete next[date];await save({...savePayload,timings:next},'Confirmed availability removed.');setDates(cur=>cur.filter(d=>d!==date));}
 function editDate(date,timing){setTab('automation');setDates([date]);setStartTime(timing.start);setEndTime(timing.end);}
 function moveEmployer(id,direction){setPreferredEmployerIds(current=>{const next=[...current];const index=next.indexOf(String(id));const target=index+direction;if(index<0||target<0||target>=next.length)return current;[next[index],next[target]]=[next[target],next[index]];return next;});}
 const confirmedDates=Object.entries(timings).filter(([,t])=>t&&t.start&&t.end&&t.confirmed!==false).sort(([a],[b])=>a.localeCompare(b));
 const stagedDates=Object.entries(timings).filter(([,t])=>t&&t.start&&t.end&&t.confirmed===false).sort(([a],[b])=>a.localeCompare(b));
 const visibleRoles=JOB_ROLE_GROUPS.map(([group,items])=>[group,items.filter(name=>name.toLowerCase().includes(roleSearch.trim().toLowerCase()))]).filter(([,items])=>items.length);
 const selectedEmployers=preferredEmployerIds.map(String).map(id=>favouriteEmployers.find(e=>String(e.business_id)===id)).filter(Boolean);
 return <section className="panel worker-availability-panel"><button className="textbutton" onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2>Availability</h2><p>Confirm the dates and times you can work over the next six weeks.</p><div className="job-tabs">{[['confirmed','Confirmed availability'],['automation','Availability automation']].map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
 {tab==='confirmed'?<div className="confirmed-availability-list confirmed-availability-only"><h3>Confirmed availability</h3>{confirmedDates.length===0?<div className="empty-state">You haven't confirmed any dates or times yet.</div>:confirmedDates.map(([date,t])=><article key={date} className="availability-date-row"><div><strong>{new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</strong><span>{t.anytime||t.start==='anytime'?'Anytime'+(t.end==='shift_end'?' – until shift ends':t.end&&t.end.startsWith('nextday:')?' – until '+t.end.slice(8)+' next day':t.end&&t.end!=='anytime'?' – until '+t.end:''):t.start+' – '+(t.end==='shift_end'?'until shift ends':t.end&&t.end.startsWith('nextday:')?'until '+t.end.slice(8)+' next day':t.end)}</span></div><button type="button" className="secondary" disabled={busy} onClick={()=>removeDate(date)}>Remove</button></article>)}</div>
 :<div className="availability-automation-settings">
 <h3>Shift preferences</h3><p>Choose the roles, shift types and employers you want hyrz to consider.</p>
 <div className="availability-collapsible shift-type-multi-filter"><label className="shift-type-filter-label">Shift types</label><button type="button" className="shift-type-picker-toggle" aria-expanded={typesOpen} onClick={()=>setTypesOpen(v=>!v)}>{shiftTypes.length===0?'All types':shiftTypes.length+' selected'} <span>{typesOpen?'▴':'▾'}</span></button>{shiftTypes.length>0&&<button type="button" className="role-clear-button shift-type-clear-button" onClick={()=>setShiftTypes([])}>Clear selected shift types</button>}{typesOpen&&<div className="shift-type-picker-panel"><div className="shift-type-picker-options">{shiftTypeOptions.map(([value,label])=><label key={value} className="shift-type-picker-option"><input type="checkbox" checked={shiftTypes.includes(value)} onChange={e=>setShiftTypes(cur=>e.target.checked?[...cur,value]:cur.filter(x=>x!==value))}/><span>{label}</span></label>)}</div><div className="shift-type-picker-footer"><button type="button" onClick={()=>setShiftTypes([])}>Clear</button><button type="button" onClick={()=>setTypesOpen(false)}>Done</button></div></div>}</div>
 <div className="availability-collapsible role-multi-filter"><div className="role-multi-filter-heading"><span>Roles</span><button type="button" className="role-picker-toggle" aria-expanded={rolesOpen} onClick={()=>setRolesOpen(v=>!v)}>{roles.length===0?'All roles':roles.length+' selected'} <span>{rolesOpen?'▴':'▾'}</span></button></div><small className="role-filter-hint">No selection includes every role.</small>{roles.length>0&&<button type="button" className="role-clear-button" onClick={()=>setRoles([])}>Clear selected roles</button>}{rolesOpen&&<div className="role-picker-panel"><input type="search" aria-label="Search preferred job roles" placeholder="Search job roles…" value={roleSearch} onChange={e=>setRoleSearch(e.target.value)}/><div className="role-picker-options">{visibleRoles.map(([group,items])=><fieldset key={group} className="role-picker-group"><legend>{group}</legend>{items.map(name=><label key={name} className="role-picker-option"><input type="checkbox" checked={roles.includes(name)} onChange={e=>setRoles(cur=>e.target.checked?[...cur,name]:cur.filter(x=>x!==name))}/><span>{name}</span></label>)}</fieldset>)}</div><div className="role-picker-footer"><span>{roles.length} selected</span><button type="button" onClick={()=>setRolesOpen(false)}>Done</button></div></div>}</div>
 <div className="availability-employer-preferences"><h4>Employers</h4><label className="availability-employer-mode">Employers to consider<select value={employerMode} onChange={e=>setEmployerMode(e.target.value)}><option value="all">All employers</option><option value="favourites">Favourites only</option></select></label>{employerMode==='favourites'&&<><p className="muted">Choose specific saved employers if you want. Put the most important employer first to set your priority when suitable shifts clash.</p><button type="button" className="role-picker-toggle" aria-expanded={employersOpen} onClick={()=>setEmployersOpen(v=>!v)}>{preferredEmployerIds.length?preferredEmployerIds.length+' preferred employers selected':'All favourite employers'} <span>{employersOpen?'▴':'▾'}</span></button>{employersOpen&&<div className="role-picker-panel"><div className="role-picker-options">{favouriteEmployers.map(employer=><label key={employer.business_id} className="role-picker-option"><input type="checkbox" checked={preferredEmployerIds.includes(String(employer.business_id))} onChange={e=>setPreferredEmployerIds(cur=>e.target.checked?[...cur,String(employer.business_id)]:cur.filter(id=>id!==String(employer.business_id)))}/><span>{employer.company_name}{employer.company_location?' · '+employer.company_location:''}</span></label>)}</div><div className="role-picker-footer"><span>{favouriteEmployers.length} favourite employers available</span><button type="button" onClick={()=>setEmployersOpen(false)}>Done</button></div></div>}{favouriteEmployers.length===0&&<p className="muted">You haven't added any employers to My favourites yet.</p>}{selectedEmployers.length>0&&<div className="availability-employer-priority"><strong>Employer priority</strong><small>First listed has highest priority if suitable shifts clash.</small>{selectedEmployers.map((employer,index)=><div className="availability-employer-priority-row" key={employer.business_id}><span>{index+1}. {employer.company_name}</span><div><button type="button" className="secondary" aria-label={'Move '+employer.company_name+' up'} disabled={index===0} onClick={()=>moveEmployer(employer.business_id,-1)}>↑</button><button type="button" className="secondary" aria-label={'Move '+employer.company_name+' down'} disabled={index===selectedEmployers.length-1} onClick={()=>moveEmployer(employer.business_id,1)}>↓</button></div></div>)}</div>}</>}</div>
 <div className="availability-rate-settings"><div className="grid2"><label>Minimum hourly rate (£)<input type="number" min="8" step="0.50" value={minHourlyRate} onChange={e=>setMinHourlyRate(String(Math.max(8,Number(e.target.value)||8)))}/></label><label>Minimum total shift pay (£)<input type="number" min="8" step="1" value={minTotalPay} onChange={e=>setMinTotalPay(String(Math.max(8,Number(e.target.value)||8)))}/></label><label>Maximum travel distance (miles)<input type="number" min="1" step="1" value={maxDistance} onChange={e=>setMaxDistance(String(Math.max(1,Math.floor(Number(e.target.value)||1))))}/></label></div></div>
 <div className="availability-timing-editor availability-timing-editor-inline"><h3>Choose dates and timings</h3><p>Select one or more dates, choose your working hours, and add them to confirmed availability.</p><div className="rolling-shift-calendar"><div className="rolling-calendar-heading"><strong>Next 6 weeks</strong><span className="muted">{dates.length?dates.length+' date(s) selected':'Select one or more dates'}</span></div><div className="rolling-calendar-days">{calendar.map(({d,key})=><button type="button" key={key} aria-pressed={dates.includes(key)} className={'rolling-calendar-day'+(dates.includes(key)?' selected':'')} onClick={()=>{if(dates.includes(key)){setDates(cur=>cur.filter(x=>x!==key));}else{setDates(cur=>[...cur,key]);setStartTime('09:00');setEndTime('17:00');}}}><small>{d.toLocaleDateString('en-GB',{weekday:'short'})}</small><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('en-GB',{month:'short'})}</span></button>)}</div></div><div className="grid2"><label>Available from<select value={startTime} onChange={e=>{const next=e.target.value;setStartTime(next);if(next!=='anytime'){const minimum=Number(next.slice(0,2))*60+Number(next.slice(3,5))+60;const minimumValue=String(Math.floor(minimum/60)%24).padStart(2,'0')+':'+String(minimum%60).padStart(2,'0');if(endTime==='shift_end'||endTime==='anytime'||endTime.startsWith('nextday:')||endTime<minimumValue)setEndTime(minimum<1440?minimumValue:'nextday:'+minimumValue);}}}><option value="anytime">Anytime</option>{Array.from({length:96},(_,i)=>{const minutes=i*15,h=String(Math.floor(minutes/60)).padStart(2,'0'),m=String(minutes%60).padStart(2,'0'),value=h+':'+m;return <option key={value} value={value}>{value}</option>})}</select></label><label>Available until<select value={endTime} onChange={e=>setEndTime(e.target.value)}><option value="shift_end">Until shift ends</option>{Array.from({length:96},(_,i)=>{const minutes=i*15,h=String(Math.floor(minutes/60)).padStart(2,'0'),m=String(minutes%60).padStart(2,'0'),value=h+':'+m,startMinutes=startTime==='anytime'?-60:Number(startTime.slice(0,2))*60+Number(startTime.slice(3,5));return {value,minutes,valid:startTime==='anytime'||minutes>=startMinutes+60};}).filter(item=>item.valid).map(({value})=><option key={value} value={value}>{value}</option>) }<optgroup label="Next day (after midnight)">{Array.from({length:96},(_,i)=>{const minutes=i*15,h=String(Math.floor(minutes/60)).padStart(2,'0'),m=String(minutes%60).padStart(2,'0'),value=h+':'+m,nextValue='nextday:'+value;return <option key={nextValue} value={nextValue}>{value} (next day)</option>})}</optgroup></select></label></div><button type="button" className="primary" disabled={!dates.length||busy} onClick={addTimings}>Add dates for confirmation</button><p className="availability-confirmed-feedback">{dates.length?'Selected dates will appear below when confirmed.':''}</p><div className="confirmed-availability-list"><h3>Confirmed availabilities</h3>{confirmedDates.length===0&&stagedDates.length===0?<p className="muted">No dates added yet.</p>:<>{stagedDates.map(([date,t])=><article key={date} className="availability-date-row"><div><strong>{new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</strong><span>{t.start==='anytime'?'Any time':t.start} – {t.end==='shift_end'?'Until the shift ends':t.end&&t.end.startsWith('nextday:')?'Until '+t.end.slice(8)+' the following day':t.end}</span><small>Awaiting automatic matching confirmation</small></div><button type="button" className="secondary" onClick={()=>editDate(date,t)}>Edit</button><button type="button" className="secondary" onClick={()=>{setTimings(current=>{const next={...current};delete next[date];return next;});}}>Remove</button></article>)}{confirmedDates.map(([date,t])=><article key={date} className="availability-date-row"><div><strong>{new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</strong><span>{t.start==='anytime'?'Any time':t.start} – {t.end==='shift_end'?'Until the shift ends':t.end&&t.end.startsWith('nextday:')?'Until '+t.end.slice(8)+' the following day':t.end}</span></div><button type="button" className="secondary" onClick={()=>editDate(date,t)}>Edit</button><button type="button" className="secondary" disabled={busy} onClick={()=>removeDate(date)}>Remove</button></article>)}</>}</div></div>
 <button type="button" className="primary availability-enable-button" onClick={()=>setConfirmAuto(true)}>Confirm automatic matching</button>
 {confirmAuto&&<div className="availability-confirm-dialog" role="dialog" aria-modal="true"><h3>Confirm automatic matching</h3><p>Confirm to activate automatic matching and publish the availability dates you have selected. Only confirmed dates will appear under Confirmed availability.</p><div><button type="button" className="primary" disabled={busy} onClick={async()=>{const confirmedTimings=Object.fromEntries(Object.entries(timings).map(([date,t])=>[date,{...t,confirmed:true}]));setAutomatic(true);setConfirmAuto(false);setDates([]);await save({...savePayload,automatic:true,timings:confirmedTimings},'Automatic matching confirmed and availability published.');}}>Confirm automatic matching</button><button type="button" className="secondary" onClick={()=>setConfirmAuto(false)}>Cancel</button></div></div>}
 </div>}
 </section>;
}

function WorkerNotifications({navigateTo,setError,setNotice}) {
 const [tab,setTab]=useState('all');
 const [preferences,setPreferences]=useState({shiftReminders:{email:true,inApp:true},shiftAcceptances:{email:true,inApp:true},shiftRescindments:{email:true,inApp:true}});
 const [loaded,setLoaded]=useState(false);
 const [saving,setSaving]=useState(false);
 useEffect(()=>{request('/worker/notification-preferences').then(r=>{if(r.preferences)setPreferences(p=>({...p,...r.preferences}));}).catch(e=>setError(e.message)).finally(()=>setLoaded(true));},[]);
 const updatePreference=async(type,channel,value)=>{const next={...preferences,[type]:{...preferences[type],[channel]:value}};setPreferences(next);setSaving(true);try{await request('/worker/notification-preferences',{method:'PUT',body:JSON.stringify({preferences:next})});setNotice('Notification settings saved.');}catch(e){setError(e.message);}finally{setSaving(false);}};
 const types=[['shiftReminders','Shift reminders','Reminders about upcoming shifts.'],['shiftAcceptances','Shift acceptances','When a shift booking is accepted.'],['shiftRescindments','Shift rescindments','When an accepted shift is rescinded or withdrawn.']];
 return <section className="panel worker-notifications-panel" style={{width:'100%',minWidth:0,boxSizing:'border-box',alignSelf:'stretch',textAlign:'center'}}><button className="textbutton" style={{display:'block',margin:'0 auto 1rem'}} onClick={()=>navigateTo('dashboard')}>← Back to Dashboard</button><h2 style={{textAlign:'center'}}>Notifications</h2><div className="job-tabs" style={{width:'100%',boxSizing:'border-box',display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))'}}>{[['all','All'],['unread','Unread'],['settings','Settings']].map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>{tab==='settings'?<div className="notification-settings" style={{textAlign:"center"}}><h3>Notification preferences</h3><p>Choose which channels can send you these notification types. Other notification types cannot be turned off here.</p>{types.map(([type,label,description])=><article className="notification-setting-row" key={type} style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:".5rem",padding:"1rem 0"}}><div><strong>{label}</strong><p>{description}</p></div><div className="notification-channel-toggles" style={{display:"flex",justifyContent:"center",gap:"1.5rem"}}>{[['email','Email'],['inApp','In-app']].map(([channel,title])=><label key={channel} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:".4rem"}}><input type="checkbox" checked={Boolean(preferences[type]?.[channel])} disabled={!loaded||saving} onChange={e=>updatePreference(type,channel,e.target.checked)}/><span>{title}</span></label>)}</div></article>)}{saving&&<p className="muted">Saving settings…</p>}</div>:<div className="empty-state">{tab==='unread'?'You have no unread notifications.':'No notifications yet. Your notifications will appear here when they are available.'}</div>}</section>;
}

function WorkerInbox({user,action,busy,setNotice,setError,goBack}) {
 const [composeOpen,setComposeOpen]=useState(false);
 const [messages,setMessages]=useState([]);
 const [loading,setLoading]=useState(true);
 const [filter,setFilter]=useState('all');
 const [section,setSection]=useState('admins');
 async function refreshMessages(){try{const r=await request('/messages/mine');setMessages(r.messages||[]);}catch(e){setError(e.message);}finally{setLoading(false);}}
 useEffect(()=>{refreshMessages();},[]);
 const inSection=m=>section==='admins'
   ? ((m.sender_role==='worker'&&m.recipient_role==='admin')||(m.sender_role==='admin'&&m.recipient_role==='worker'))
   : ((m.sender_role==='worker'&&m.recipient_role==='employer')||(m.sender_role==='employer'&&m.recipient_role==='worker'));
 const sectionMessages=messages.filter(inSection);
 const visible=sectionMessages.filter(m=>filter==='all'?true:filter==='received'?Number(m.sender_id)!==Number(user.id):filter==='sent'?Number(m.sender_id)===Number(user.id):Number(m.sender_id)!==Number(user.id)&&!m.read_at);
 const unreadCount=sectionMessages.filter(m=>Number(m.sender_id)!==Number(user.id)&&!m.read_at).length;
 return <section className="panel worker-inbox-panel">
  <div className="worker-inbox-heading"><div><button className="textbutton" onClick={goBack}>← Back</button><h2>Inbox</h2><p>Your conversations and messages.</p></div><button type="button" className="compose-message-button" aria-label="Compose a new message" title="Compose a new message" onClick={()=>setComposeOpen(v=>!v)}>{composeOpen?'×':'✎'}</button></div>
  <div className="job-tabs inbox-section-tabs">{[['admins','Admins'],['employers','Employers']].map(([id,label])=><button type="button" key={id} className={section===id?'active':''} onClick={()=>{setSection(id);setFilter('all');}}>{label} ({messages.filter(m=>id==='admins'?((m.sender_role==='worker'&&m.recipient_role==='admin')||(m.sender_role==='admin'&&m.recipient_role==='worker')):((m.sender_role==='worker'&&m.recipient_role==='employer')||(m.sender_role==='employer'&&m.recipient_role==='worker'))).length})</button>)}</div><div className="job-tabs inbox-tabs">{[['all','All'],['received','Received'],['sent','Sent'],['unread','Unread']].map(([id,label])=><button type="button" key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label}{id==='unread'?' ('+unreadCount+')':''}</button>)}</div>
  {composeOpen&&<div className="worker-inbox-compose"><div className="worker-inbox-compose-heading"><h3>New message</h3><p>Send a new message to hyrz support.</p></div><SupportContact user={user} action={action} busy={busy} setNotice={setNotice} setError={setError}/></div>}
  <div className="worker-inbox-messages">{loading?<p className="muted">Loading messages…</p>:visible.length===0?<div className="empty-state">No {filter==='all'?'messages':filter+' messages'} to show.</div>:visible.map(m=><article className="worker-inbox-message" key={m.id}><div className="worker-inbox-message-top"><strong>{m.subject||'Message'}</strong><small>{new Date(m.created_at).toLocaleString('en-GB')}</small></div><p>{m.body}</p><small>{Number(m.sender_id)===Number(user.id)?'Sent by you':'Received'} · {m.read_at?'Read':'Unread'}</small></article>)}</div>
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
 return <section className="panel admin-message-form"><h2>Contact hyrz support</h2><p>Send a message for the support team to review.</p><form onSubmit={submit}><label>Message type<select value={category} onChange={e=>setCategory(e.target.value)}><option value="enquiries">Enquiry</option><option value="complaints">Complaint</option><option value="checkout_disputes">Checkout dispute</option></select></label><label>Subject<input required minLength="2" maxLength="200" value={subject} onChange={e=>setSubject(e.target.value)}/></label><label>Message<textarea required maxLength="5000" value={body} onChange={e=>setBody(e.target.value)}/></label><button className="primary" disabled={busy}>Send to support</button>{sent&&<p role="status">Message sent successfully.</p>}</form><h3>Your support messages</h3><DataList items={messages} empty="No support messages yet." render={m=><article className="admin-record" key={m.id}><strong>{m.subject||'Support message'} · {(m.category||'enquiries').replace('_',' ')}</strong><small>{new Date(m.created_at).toLocaleString('en-GB')} · {Number(m.sender_id)===Number(user.id)?'You sent this':'hyrz support replied'} · {m.read_at?'Read':'Unread'}</small><p>{m.body}</p>{Number(m.sender_id)!==Number(user.id)&&<button type="button" className="secondary" onClick={()=>reply(m)}>Reply</button>}</article>}/></section>;
}

function CounterOfferForm({checkout,action,busy,onDone,setNotice}) {
 const [open,setOpen]=useState(false);
 const [comment,setComment]=useState('');
 const [actualStart,setActualStart]=useState(String(checkout.actual_start||'').replace(' ','T').slice(0,16));
 const [actualEnd,setActualEnd]=useState(String(checkout.actual_end||'').replace(' ','T').slice(0,16));
 const [breakMinutes,setBreakMinutes]=useState(String(checkout.break_minutes??0));
 return <div className="counter-offer"><button type="button" className="secondary" onClick={()=>setOpen(v=>!v)}>{open?'Cancel counter-offer':'Dispute / counter-offer'}</button>{open&&<form onSubmit={e=>{e.preventDefault();action(async()=>{await request('/checkouts/'+checkout.id+'/counter-offer',{method:'POST',body:JSON.stringify({comment,actualStart:actualStart?actualStart.replace('T',' ')+':00':undefined,actualEnd:actualEnd?actualEnd.replace('T',' ')+':00':undefined,breakMinutes:Number(breakMinutes)})});setNotice('Counter-offer submitted for admin review.');setOpen(false);await onDone();});}}><label>Comment / reason<textarea required minLength="3" maxLength="3000" value={comment} onChange={e=>setComment(e.target.value)}/></label><label>Proposed start<input type="datetime-local" required value={actualStart} onChange={e=>setActualStart(e.target.value)}/></label><label>Proposed end<input type="datetime-local" required value={actualEnd} onChange={e=>setActualEnd(e.target.value)}/></label><label>Proposed break minutes<input type="number" min="0" required value={breakMinutes} onChange={e=>setBreakMinutes(e.target.value)}/></label><button className="primary" disabled={busy}>Submit counter-offer</button></form>}</div>;
}
