process.env.TZ = 'Europe/Bucharest';

const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween, isoWeek, weekBounds, parseDate } = require('../src/dates');
const { classify, recordSpeed } = require('../src/gps/tracker');

const GPS = {
  faraSemnalMinutePornit: 15, faraSemnalOreOprit: 24, vitezaMinimaMiscare: 5, vitezaMaximaPlauzibila: 180,
};

test('parseDate reads the formats people actually type', () => {
  assert.deepEqual(parseDate('15.11.2026'), new Date(2026, 10, 15));
  assert.deepEqual(parseDate('15/11/26'), new Date(2026, 10, 15));
  assert.deepEqual(parseDate('2026-11-15'), new Date(2026, 10, 15));
  assert.deepEqual(parseDate('15.11.2026 08:30'), new Date(2026, 10, 15, 8, 30));
});

test('parseDate rejects impossible dates instead of rolling them over', () => {
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(parseDate('15.13.2026'), null);
  assert.equal(parseDate('curând'), null);
});

test('parseDate keeps the wall-clock of real Excel dates', () => {
  assert.deepEqual(parseDate(new Date(Date.UTC(2026, 10, 15, 8, 30))), new Date(2026, 10, 15, 8, 30));
  assert.deepEqual(parseDate(46341), new Date(2026, 10, 15));
});

test('daysBetween survives the daylight-saving change', () => {
  assert.equal(daysBetween(new Date(2026, 9, 24, 23, 0), new Date(2026, 9, 26, 1, 0)), 2);
  assert.equal(daysBetween(new Date(2026, 10, 2, 23, 59), new Date(2026, 10, 2, 0, 1)), 0);
});

test('week is Monday to Sunday with the ISO number', () => {
  const sunday = new Date(2026, 10, 8, 23, 0);
  assert.deepEqual(isoWeek(new Date(2026, 10, 2)), { year: 2026, week: 45 });
  assert.deepEqual(isoWeek(sunday), { year: 2026, week: 45 });
  assert.deepEqual(weekBounds(sunday).start, new Date(2026, 10, 2));
  assert.deepEqual(weekBounds(sunday).end, new Date(2026, 10, 9));
});

test('classify separates moving, idling, off and silent vehicles', () => {
  const now = Date.now();
  const position = (speed, ignition, ageMinutes = 0) => ({ speed, ignition, timestamp: now - ageMinutes * 60000 });
  assert.equal(classify(position(60, true), now, GPS), 'moving');
  assert.equal(classify(position(2, true), now, GPS), 'idle');
  assert.equal(classify(position(0, false), now, GPS), 'off');
  assert.equal(classify(position(60, true, 16), now, GPS), 'nosignal');
  // A parked tracker reports rarely: a few hours of silence with the ignition off is normal.
  assert.equal(classify(position(0, false, 300), now, GPS), 'off');
  assert.equal(classify(position(0, false, 25 * 60), now, GPS), 'nosignal');
});

test('recordSpeed keeps the weekly maximum and ignores GPS spikes and old data', () => {
  const week = { maxes: {} };
  const now = Date.now();
  assert.equal(recordSpeed(week, { plate: 'A', speed: 90, at: now }, GPS), true);
  assert.equal(recordSpeed(week, { plate: 'A', speed: 70, at: now }, GPS), false);
  assert.equal(recordSpeed(week, { plate: 'A', speed: 250, at: now }, GPS), false);
  assert.equal(recordSpeed(week, { plate: 'A', speed: 120, at: now - 9 * 86400000 }, GPS), false);
  assert.equal(week.maxes.A.speed, 90);
});
