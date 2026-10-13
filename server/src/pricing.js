function calculatePay({ hourlyPay, startsAt, endsAt, breakMinutes = 0 }) {
  const rate = Number(hourlyPay);
  const durationHours = (new Date(endsAt) - new Date(startsAt)) / 3600000 - Number(breakMinutes) / 60;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error('Invalid pay rate or shift duration');
  }
  const gross = Math.round(rate * durationHours * 100) / 100;
  const feeRate = rate <= 20 ? 2 : rate * 0.10;
  const fee = Math.round(feeRate * durationHours * 100) / 100;
  return { durationHours: Math.round(durationHours * 100) / 100, grossPay: gross, platformFee: fee, employerTotal: Math.round((gross + fee) * 100) / 100 };
}
module.exports = { calculatePay };
