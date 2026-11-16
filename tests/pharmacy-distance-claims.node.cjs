'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'app/api/pharmacies/route.ts'), 'utf8');
const card = fs.readFileSync(path.join(root, 'components/PharmacyCard.tsx'), 'utf8');
const home = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8');
const start = route.indexOf('// Only calculate a distance from an actual user location.');
const end = route.indexOf('    return NextResponse.json(', start);
assert.ok(start >= 0 && end > start, 'Expected actual route distance transform section');
const actualRouteSection = route.slice(start, end);
// Execute the actual TypeScript route's pure JavaScript mapping/sorting section,
// not a separate copy of the production logic; Next.js providers remain mocked.
const applyDistance = new Function('pharmacies', 'lat', 'lng', 'calculateDistanceKm',
  actualRouteSection + '\nreturn pharmacies;');
const calculateDistanceKm = (a, b, c, d) => Math.hypot(a - c, b - d);
const row = (id, latitude, longitude, distance) => ({ id, latitude, longitude, distance });
const run = (rows, lat, lng) => applyDistance(rows, lat, lng, calculateDistanceKm);

test('manual lookup never fabricates kilometer distances or reorders provider results', () => {
  const result = run([row('b', 38.45, 27.2, 1.4), row('a', 38.46, 27.21, 0.8)], undefined, undefined);
  assert.deepEqual(result.map(p => p.id), ['b', 'a']);
  assert.deepEqual(result.map(p => p.distance), [undefined, undefined]);
});

test('incomplete user coordinates cannot manufacture a ranking', () => {
  for (const args of [[38.4, undefined], [undefined, 27.1]]) {
    const out = run([row('a', 38.45, 27.2, 99)], ...args);
    assert.equal(out[0].distance, undefined);
  }
});

test('GPS ranks only valid geographic coordinates, with invalid or zero-zero last', () => {
  const out = run([
    row('missing', 0, 0, 0),
    row('far', 38.7, 27.4, undefined),
    row('nan', NaN, 27.1, undefined),
    row('near', 38.41, 27.11, undefined),
  ], 38.4, 27.1);
  assert.deepEqual(out.map(p => p.id), ['near', 'far', 'missing', 'nan']);
  assert.ok(out[0].distance > 0);
  assert.equal(out[2].distance, undefined);
  assert.equal(out[3].distance, undefined);
});

test('card labels require a current GPS flag and a finite nonnegative distance', () => {
  assert.match(card, /distanceFromUser\?: boolean/);
  assert.match(card, /distanceFromUser && typeof pharmacy\.distance === "number"/);
  assert.match(card, /index === 0 && !elderMode && userDistance !== null/);
  assert.match(card, /index === 0 && elderMode && userDistance !== null/);
  assert.match(card, /Mesafe için konum gerekli/);
  assert.match(card, /kuş uçuşu/);
});

test('home blocks location ranking claims for manual or offline results', () => {
  assert.match(home, /hasCurrentGpsDistances = gpsStatus === "granted" && !selectedArea && !isOfflineData/);
  assert.match(home, /distanceFromUser=\{hasCurrentGpsDistances\}/);
  assert.match(home, /\{hasCurrentGpsDistances && \(/);
  assert.doesNotMatch(home, /En Yakın 3 Eczane/);
});
