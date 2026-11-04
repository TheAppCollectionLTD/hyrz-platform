// UK PAYE calculations (England, Wales and Northern Ireland bands) on a non-cumulative weekly basis.
// Thresholds are frozen; confirm figures each April before relying on them for real payroll.
const TAX_YEAR = {
  label: '2026/27',
  personalAllowance: 12570,
  basicBand: 37700,
  higherLimit: 125140,
  rates: { basic: 0.2, higher: 0.4, additional: 0.45 },
  ni: { primaryWeekly: 242, upperWeekly: 967, main: 0.08, upper: 0.02, secondaryWeekly: 96, employer: 0.15, upperSecondaryWeekly: 967 },
};

const TAX_CODE = /^C?(?:(\d{1,4})[LMNT]|K(\d{1,4})|BR|D0|D1|NT|0T)$/i;
const NI_CATEGORIES = ['A', 'M', 'H', 'C'];
const round = n => Math.round(n * 100) / 100;

function validTaxCode(code) { return TAX_CODE.test(String(code || '').trim().replace(/\s+/g, '')); }

function weeklyIncomeTax(gross, rawCode) {
  const code = String(rawCode || '1257L').toUpperCase().replace(/\s+/g, '').replace(/^C/, '');
  const { rates, basicBand, higherLimit, personalAllowance } = TAX_YEAR;
  if (code === 'NT') return 0;
  if (code === 'BR') return round(gross * rates.basic);
  if (code === 'D0') return round(gross * rates.higher);
  if (code === 'D1') return round(gross * rates.additional);
  let allowance = 0;
  const l = code.match(/^(\d{1,4})[LMNT]$/), k = code.match(/^K(\d{1,4})$/);
  if (l) allowance = (Number(l[1]) * 10 + 9) / 52;
  if (k) allowance = -(Number(k[1]) * 10 + 9) / 52;
  const taxable = Math.max(0, gross - allowance);
  const basic = basicBand / 52, higher = (higherLimit - personalAllowance - basicBand) / 52;
  let tax = Math.min(taxable, basic) * rates.basic
    + Math.min(Math.max(taxable - basic, 0), higher) * rates.higher
    + Math.max(taxable - basic - higher, 0) * rates.additional;
  if (k) tax = Math.min(tax, gross * 0.5);
  return round(tax);
}

function weeklyEmployeeNi(gross, category = 'A') {
  if (category === 'C') return 0;
  const { primaryWeekly, upperWeekly, main, upper } = TAX_YEAR.ni;
  return round(Math.max(0, Math.min(gross, upperWeekly) - primaryWeekly) * main + Math.max(0, gross - upperWeekly) * upper);
}

function weeklyEmployerNi(gross, category = 'A') {
  const { secondaryWeekly, employer, upperSecondaryWeekly } = TAX_YEAR.ni;
  const exemptTo = ['M', 'H'].includes(category) ? upperSecondaryWeekly : secondaryWeekly;
  return round(Math.max(0, gross - exemptTo) * employer);
}

// Tax weeks run from 6 April; returns { taxYear, week, start, end }.
function taxWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let startYear = d.getUTCFullYear();
  if (d < new Date(Date.UTC(startYear, 3, 6))) startYear -= 1;
  const yearStart = new Date(Date.UTC(startYear, 3, 6));
  const week = Math.min(53, Math.floor((d - yearStart) / (7 * 86400000)) + 1);
  const start = new Date(yearStart.getTime() + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { taxYear: `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`, week, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function buildPayslip(period, payType, setting, lines) {
  const gross = round(lines.reduce((t, l) => t + l.gross, 0));
  if (payType !== 'paye') return { ...period, payType: 'contractor', lines, gross, incomeTax: 0, employeeNi: 0, employerNi: 0, net: gross };
  const incomeTax = weeklyIncomeTax(gross, setting.tax_code);
  const employeeNi = weeklyEmployeeNi(gross, setting.ni_category);
  return { ...period, payType: 'paye', taxCode: setting.tax_code, niCategory: setting.ni_category, lines, gross, incomeTax, employeeNi,
    employerNi: weeklyEmployerNi(gross, setting.ni_category), net: round(gross - incomeTax - employeeNi) };
}

module.exports = { TAX_YEAR, NI_CATEGORIES, validTaxCode, weeklyIncomeTax, weeklyEmployeeNi, weeklyEmployerNi, taxWeekOf, buildPayslip };
