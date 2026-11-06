export const TERMS_VERSION = '2026-11-06';
export const TERMS_EFFECTIVE = '6 November 2026';

// [id, part, title, summary, points[]]
export const TERMS_SECTIONS = [
  ['about', 'Part A · Everyone', 'Who we are and what these terms cover', 'These terms are the agreement between you and HYRZ for using the hyrz app and website.', [
    'hyrz is operated by HYRZ ("HYRZ", "we", "us"). hyrz is a marketplace and staffing service that connects people looking for flexible work ("workers") with businesses that need staff ("employers").',
    'These terms apply to everyone who creates an account. Part B applies to workers, Part C applies to employers and Parts A and D apply to everyone.',
    'If you are paid through hyrz PAYE, your hyrz PAYE employment contract also applies. If you work as an independent contractor, the independent contractor agreement and the shift contract for each shift also apply. If anything in those documents conflicts with these terms, that document wins for that topic.',
    'Nothing in these terms takes away any rights you have by law, including your rights as a consumer, a worker or an employee.',
  ]],
  ['definitions', 'Part A · Everyone', 'Words we use', 'A quick guide to the key terms used in this document.', [
    'Shift: a period of work posted by an employer, with a role, location, date, times, hourly rate and requirements.',
    'Application: a worker\'s request to work a shift. It is only confirmed when the employer approves it.',
    'Checkout: the record of hours a worker actually worked, submitted after the shift and approved (or changed by a counter-offer) by the employer.',
    'Independent contractor: a self-employed worker who is paid gross and handles their own tax.',
    'hyrz PAYE employee: a worker employed by HYRZ, paid weekly through the PAYE system with Income Tax and National Insurance taken off.',
    'Platform fee: the fee HYRZ charges employers for hours worked, explained in section 14.',
  ]],
  ['accounts', 'Part A · Everyone', 'Your account', 'You must be 18 or over, give true details and keep your login safe.', [
    'You must be at least 18 years old and, if you are a worker, have the right to work in the UK.',
    'You may only have one account. The information you give us (name, contact details, National Insurance or permit number, business details and payment details) must be true and kept up to date.',
    'Keep your password private. You are responsible for activity on your account. Tell us straight away through the contact form if you think someone else has accessed it.',
    'We store a one-way hash of your National Insurance or worker permit number, not the number itself, so we can stop blocked users from opening new accounts.',
  ]],
  ['verification', 'Part A · Everyone', 'Verification checks', 'Before you can apply for or post shifts, we check your email, your identity and (for employers) your business.', [
    'Every account must verify its email address.',
    'Workers must complete an identity and right-to-work check. Employers must complete an identity check for the account holder. Identity checks are carried out by our provider, Stripe Identity, which handles your ID documents on our behalf.',
    'Employers must verify their business. For UK companies we check the registration number against the Companies House register.',
    'Until all checks are complete you can browse but cannot apply for shifts, post shifts or approve hours. We may ask you to repeat a check, and we may refuse or suspend an account if a check fails or the information looks false.',
  ]],
  ['applying', 'Part B · Workers', 'Finding and applying for shifts', 'You choose which shifts to apply for. A shift is only yours once the employer approves you.', [
    'You decide which shifts to apply for. Nobody is obliged to offer you work, and you are not obliged to accept any shift.',
    'Before applying, read the shift details: location, date, times, hourly rate, requirements and payment terms. Only apply for shifts you can genuinely attend.',
    'You may ask for a different hourly rate when you apply. The employer can accept or decline the request.',
    'If you turn on availability automation, hyrz uses the availability and preferences you confirm (roles, dates, times, minimum rate and travel distance) to suggest or apply for matching shifts. Keep these settings accurate.',
    'Some shifts ask you to confirm your place shortly before the shift. If you do not confirm in time, the place may be given to someone else.',
  ]],
  ['pay-type', 'Part B · Workers', 'Choosing how you are paid', 'You choose to be an independent contractor or a hyrz PAYE employee. You can switch at any time.', [
    'When you sign up you choose one of two ways to work: as an independent contractor, or as an employee of HYRZ paid through PAYE. You must agree to the matching contract.',
    'You can switch at any time in Profile > Pay & tax. You agree to the contract for the new option each time you switch.',
    'A switch takes effect straight away. Shifts you have already worked are paid in the way they were worked. Shifts you work after the switch are paid under the new option.',
  ]],
  ['contractor', 'Part B · Workers', 'If you work as an independent contractor', 'You are self-employed, you agree a contract for each shift, you are paid gross and you handle your own tax.', [
    'You are self-employed. You are not an employee of HYRZ or of the employer.',
    'Each shift has its own shift contract. You must read and agree to it before you apply.',
    'You are paid your full gross pay for the hours the employer approves. HYRZ does not take off Income Tax or National Insurance.',
    'You are paid on the employer\'s payment terms, up to 14 days after your hours are approved. Where a shift shows an "Instant Pay available" badge, you can be paid as soon as your hours are approved.',
    'You must register with HMRC as self-employed and declare this income through Self Assessment.',
  ]],
  ['paye', 'Part B · Workers', 'If you are a hyrz PAYE employee', 'HYRZ employs you, pays you weekly one week in arrears and takes off tax and NI for you.', [
    'You are employed by HYRZ on a casual, flexible-hours basis under the hyrz PAYE employment contract. That one contract covers every shift, so there is no separate shift contract.',
    'You are paid weekly, one week in arrears. Pay weeks follow the UK tax week. Approved hours for one pay week are paid on the Friday of the following week.',
    'HYRZ works out and takes off Income Tax (using your tax code) and employee National Insurance automatically, and pays employer National Insurance. You get a payslip every pay week, which you can download as a PDF.',
    'Instant Pay is not available on PAYE.',
    'You must give us your correct tax code and National Insurance category and update them if HMRC changes them.',
  ]],
  ['working', 'Part B · Workers', 'Working the shift and recording your hours', 'Turn up on time, follow reasonable instructions and record your hours honestly.', [
    'Arrive on time, follow reasonable workplace, health and safety instructions and tell the employer straight away through the app if something affects your attendance.',
    'After the shift you submit a checkout with your actual start time, finish time and breaks. Record your hours honestly.',
    'The employer approves your checkout or sends a counter-offer with different times. You can accept the counter-offer or raise a dispute.',
  ]],
  ['worker-cancel', 'Part B · Workers', 'Cancelling a shift and strikes', 'Cancelling within 24 hours of a shift gives you a strike. Three strikes stops you booking shifts.', [
    'You can cancel an approved shift in the app. If you cancel within 24 hours of the start time, or do not turn up, you receive a strike.',
    'If you reach three strikes you cannot book more shifts until your strikes are reviewed. You can appeal a strike through the complaints section.',
  ]],
  ['posting', 'Part C · Employers', 'Posting shifts', 'Describe each shift accurately and lawfully, and pay at least the legal minimum.', [
    'Shift details must be accurate and complete: role, location, date, times, breaks, hourly rate, number of workers, requirements and payment terms.',
    'Rates must meet at least the National Minimum Wage or National Living Wage that applies to the worker.',
    'You are responsible for a safe workplace, inductions, any equipment needed and following employment, equality, licensing and health and safety law at your site.',
  ]],
  ['managing', 'Part C · Employers', 'Choosing and managing workers', 'You choose who to approve. Treat workers fairly and communicate through hyrz.', [
    'You review applications and decide who to approve. You can also make private offers to workers you have favourited.',
    'Treat workers fairly and with respect, and do not discriminate unlawfully.',
    'If you cancel a shift with approved workers within 24 hours of the start time, a cancellation fine of 50% of the total shift pay for each approved worker applies.',
  ]],
  ['approving', 'Part C · Employers', 'Approving hours', 'Review checkouts promptly. Approved hours are invoiced.', [
    'Review each worker\'s checkout promptly. You can approve it or send a counter-offer with the times you believe were worked.',
    'When hours are approved, an invoice is raised for the worker\'s pay plus the platform fee.',
  ]],
  ['fees', 'Part C · Employers', 'Fees, invoices and the bulk rate', '£2 per hour worked up to a £20 hourly rate, 10p per £1 above that, and £1.50 per hour if you hire 5+ workers for 40+ hours in a week.', [
    'For each hour worked at an hourly rate of £20 or less, the platform fee is £2.00 per hour.',
    'For hourly rates above £20, the platform fee is 10p for every £1 paid to the worker (10% of their pay).',
    'Bulk rate: if 5 or more different workers work for you in the same Monday to Sunday week, for a total of at least 40 hours, the fee for hours at £20 or less drops to £1.50 per hour. Fees above £20 stay at 10%.',
    'Invoices are raised at the standard rate when hours are approved. When a week that qualifies for the bulk rate ends, the difference is added to your account as a credit. You can follow your progress on the Invoices page.',
    'Invoices must be paid by their due date. We send reminders for overdue invoices and may pause your ability to post shifts if invoices remain unpaid.',
    'If you offer Instant Pay, you must keep enough funds in your Instant Pay balance to cover it.',
  ]],
  ['messaging', 'Part D · Everyone', 'Messages, workchats and behaviour', 'Be respectful. No harassment, spam or sharing other people\'s private details.', [
    'hyrz includes direct messages and group workchats. Use them for work. Do not harass, threaten, discriminate against or abuse anyone, and do not send spam or unlawful content.',
    'Do not use hyrz to arrange work or payment outside the platform for people you met through hyrz.',
    'We may review reported messages and remove content or restrict accounts that break these rules.',
  ]],
  ['ratings', 'Part D · Everyone', 'Ratings and reviews', 'Ratings must be honest and based on real shifts.', [
    'After a shift, employers and workers can rate each other. Ratings must be honest and based on the shift itself.',
    'We may remove ratings that are abusive, false or unrelated to the shift.',
  ]],
  ['disputes', 'Part D · Everyone', 'Complaints and disputes', 'Tell us through the app and we will review it.', [
    'If something goes wrong with a shift, hours, pay, an invoice or another user, raise it through the complaints section or the contact form.',
    'We will look at the information both sides provide and tell you the outcome. Our decision does not stop you using any legal route you have.',
  ]],
  ['privacy', 'Part D · Everyone', 'Your information', 'We use your information to run hyrz, keep it safe and meet our legal duties.', [
    'We use your account, verification, shift, pay and message information to provide the service, process pay and invoices, prevent fraud, support you and meet legal and tax duties.',
    'Identity documents are handled by Stripe Identity. We share business details with Companies House only to check them. We share shift and profile details between workers and employers as needed for each shift.',
    'We keep information for as long as needed for these purposes and for any period the law requires, for example payroll records.',
    'You can ask us for a copy of your information, or ask us to correct or delete it, through the contact form, subject to the law.',
  ]],
  ['suspension', 'Part D · Everyone', 'Suspending or closing accounts', 'You can close your account at any time. We may suspend accounts that break these terms.', [
    'You can ask us to close your account at any time. Shifts already worked, pay and invoices still have to be settled.',
    'We may suspend or close an account if checks fail, information is false, invoices remain unpaid, the user reaches three strikes or these terms are broken. Where it is safe to do so, we will tell you why.',
  ]],
  ['liability', 'Part D · Everyone', 'Our responsibility to you', 'We take reasonable care in running hyrz, and we do not limit liability where the law does not allow it.', [
    'We take reasonable care to keep hyrz working and secure, but we cannot promise it will always be available or error-free.',
    'Employers are responsible for their workplaces and for the instructions they give. Workers are responsible for the information they give and for following reasonable instructions.',
    'Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law.',
  ]],
  ['changes', 'Part D · Everyone', 'Changes to these terms', 'If we change these terms, we will tell you and ask you to agree again where needed.', [
    'We may update these terms to reflect changes in the law or in how hyrz works. Each version has a version number and effective date.',
    'We will tell you about important changes before they apply and, where needed, ask you to agree to the new version.',
  ]],
  ['law', 'Part D · Everyone', 'Law and contact', 'These terms are governed by the law of England and Wales.', [
    'These terms are governed by the law of England and Wales. If you live in Scotland or Northern Ireland, you can also bring a claim in your local courts.',
    'You can contact HYRZ at any time through the contact form in the app or on the website.',
  ]],
];
