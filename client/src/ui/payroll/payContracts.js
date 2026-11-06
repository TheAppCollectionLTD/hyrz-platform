export const CONTRACT_VERSIONS = { contractor: 'hyrz-contractor-v1', paye: 'hyrz-paye-employment-v1' };

export const PAY_CONTRACTS = {
  contractor: {
    title: 'Independent contractor agreement',
    sections: [
      ['Your status', 'You work through hyrz as a self-employed independent contractor. You are not an employee of hyrz or of the businesses you work for, and you choose which shifts to apply for.'],
      ['A contract for every shift', 'Each shift has its own shift contract showing the role, location, times, hourly rate and payment terms. You must read and agree to it before you apply.'],
      ['How much you are paid', 'You are paid your full gross pay for the hours the business approves. hyrz does not take off Income Tax or National Insurance.'],
      ['When you are paid', 'You are paid on the business\'s payment terms, which is up to 14 days after your hours are approved. If a shift shows an "Instant Pay available" badge, you can be paid as soon as your hours are approved.'],
      ['Your tax', 'You must register with HMRC as self-employed and declare this income through Self Assessment, paying your own Income Tax and Class 4 National Insurance.'],
      ['Switching to PAYE', 'You can switch to hyrz PAYE at any time in Profile > Pay & tax. The switch takes effect straight away. Shifts you have already worked are still paid on contractor terms, and shifts you work after the switch are paid through PAYE.'],
    ],
  },
  paye: {
    title: 'hyrz PAYE employment contract',
    sections: [
      ['Your employer', 'You are employed by hyrz on a casual, flexible-hours basis. hyrz places you on shifts with client businesses. You are not obliged to accept shifts, and hyrz is not obliged to offer them.'],
      ['One contract for every shift', 'This contract covers every shift you work through hyrz, so you do not sign a separate contract for each shift. Each job listing still shows the role, location, times and hourly rate.'],
      ['Pay week and pay day', 'You are paid weekly, one week in arrears. Pay weeks follow the UK tax week. Hours approved for shifts in one pay week are paid on the Friday of the following week. For example, a shift worked on a Tuesday is paid on the Friday of the next week, not that same week.'],
      ['Tax and National Insurance', 'hyrz works out and takes off Income Tax (using your tax code) and employee National Insurance automatically. You get a payslip for every pay week, which you can download as a PDF.'],
      ['Instant Pay', 'Instant Pay is not available on PAYE. Your pay always follows the weekly schedule above.'],
      ['Your details', 'You confirm your tax code and National Insurance category are correct and will update them if HMRC changes them. A wrong tax code can mean you pay too much or too little tax.'],
      ['Your rights', 'You keep your statutory rights as a hyrz worker under UK law, including the National Minimum Wage.'],
      ['Switching to contractor', 'You can switch to independent contractor at any time in Profile > Pay & tax. The switch takes effect straight away. Shifts you worked on PAYE are still paid through PAYE on the normal weekly pay day, and shifts you work after the switch are paid gross on contractor terms.'],
    ],
  },
};

export const SWITCH_NOTES = {
  paye: ['Takes effect straight away.', 'Shifts you already worked as a contractor are still paid gross on the business\'s payment terms.', 'Shifts you work from now on are paid through PAYE: weekly, one week in arrears, on the Friday after the pay week ends, with tax and NI taken off.', 'Instant Pay badges and per-shift contracts will no longer appear on jobs.'],
  contractor: ['Takes effect straight away.', 'Shifts you already worked on PAYE are still paid through PAYE on their normal weekly pay day.', 'Shifts you work from now on are paid gross, with no tax or NI taken off. You declare the income through Self Assessment.', 'You will agree to a shift contract each time you apply, and Instant Pay is shown where available.'],
};
