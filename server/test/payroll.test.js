const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyIncomeTax, weeklyEmployeeNi, weeklyEmployerNi, taxWeekOf, validTaxCode } = require('../src/payroll');

test('1257L weekly tax on £500', () => assert.equal(weeklyIncomeTax(500, '1257L'), 51.62));
test('BR and NT codes', () => { assert.equal(weeklyIncomeTax(200, 'BR'), 40); assert.equal(weeklyIncomeTax(200, 'NT'), 0); });
test('employee NI category A on £500', () => assert.equal(weeklyEmployeeNi(500, 'A'), 20.64));
test('employer NI on £500', () => assert.equal(weeklyEmployerNi(500, 'A'), 60.6));
test('under-21 employer NI relief', () => assert.equal(weeklyEmployerNi(500, 'M'), 0));
test('tax week numbering from 6 April', () => { assert.equal(taxWeekOf(new Date('2026-04-06')).week, 1); assert.equal(taxWeekOf(new Date('2026-04-05')).taxYear, '2025/26'); });
test('tax code validation', () => { assert.ok(validTaxCode('1257L')); assert.ok(validTaxCode('K475')); assert.ok(!validTaxCode('hello')); });
