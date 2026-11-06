const FEES = { standardHourly: 2, bulkHourly: 1.5, rateCap: 20, percentAboveCap: 0.10, bulkMinWorkers: 5, bulkMinHours: 40 };
const round = n => Math.round(n * 100) / 100;

function hourlyFee(rate, bulk = false) {
  return rate <= FEES.rateCap ? (bulk ? FEES.bulkHourly : FEES.standardHourly) : rate * FEES.percentAboveCap;
}

function calculatePay({ hourlyPay, startsAt, endsAt, breakMinutes = 0, bulk = false }) {
  const rate = Number(hourlyPay);
  const durationHours = (new Date(endsAt) - new Date(startsAt)) / 3600000 - Number(breakMinutes) / 60;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error('Invalid pay rate or shift duration');
  }
  const gross = round(rate * durationHours);
  const fee = round(hourlyFee(rate, bulk) * durationHours);
  return { durationHours: round(durationHours), grossPay: gross, platformFee: fee, employerTotal: round(gross + fee) };
}

// lines: [{ workerId, hours, rate, fee }] for one business in one Monday–Sunday week.
function weeklyBulkCredit(lines) {
  const workers = new Set(lines.map(l => String(l.workerId))).size;
  const hours = round(lines.reduce((t, l) => t + Number(l.hours), 0));
  const qualifies = workers >= FEES.bulkMinWorkers && hours >= FEES.bulkMinHours;
  const credit = qualifies ? round(lines.reduce((t, l) => Number(l.rate) <= FEES.rateCap ? t + Math.max(0, Number(l.fee) - round(FEES.bulkHourly * Number(l.hours))) : t, 0)) : 0;
  return { workers, hours, qualifies, credit };
}

module.exports = { FEES, hourlyFee, calculatePay, weeklyBulkCredit };
