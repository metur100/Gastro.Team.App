// End-to-end API smoke test against a running GastroTeam API with demo data.
// Usage: node scripts/smoke-test.mjs [baseUrl] [demoPassword]
// Creates a few records in the demo tenant (shifts, leave). Do not run against production data.
const base = (process.argv[2] ?? 'http://localhost:5191').replace(/\/$/, '');
const password = process.argv[3] ?? process.env.DEMO_PASSWORD ?? 'Demo-Passwort-2026';
const api = `${base}/api/v1`;
let failures = 0;

async function call(method, path, token, body, expected) {
  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  const ok = expected ? res.status === expected : res.ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} -> ${res.status}${ok ? '' : ' ' + text.slice(0, 300)}`);
  if (!ok) failures++;
  return json;
}

async function login(email) {
  const r = await call('POST', '/auth/login', null, { email, password });
  return r?.accessToken;
}

const owner = await login('inhaber@rheinblick.example');
const manager = await login('leitung@rheinblick.example');
const employee = await login('mia.schmidt@rheinblick.example');

const me = await call('GET', '/auth/me', owner);
console.log('  tenant:', me?.currentTenant?.name, me?.currentTenant?.role);
await call('GET', '/dashboard/summary', owner);
await call('GET', '/dashboard/action-items', owner);
const locations = await call('GET', '/locations', owner);
const altstadt = locations.find((l) => l.name.includes('Altstadt'));
const hafen = locations.find((l) => l.name.includes('Hafen'));
const roles = await call('GET', '/job-roles', owner);
const today = new Date().toISOString().slice(0, 10);
const week = await call('GET', `/schedules/week?locationId=${altstadt.id}&date=${today}`, owner);
console.log(`  week ${week.weekStart}: ${week.shifts.length} shifts, ${week.issues.length} issues, state ${week.publication.state}`);
await call('GET', '/employees?pageSize=5', owner);

// Manager must not manage the Hafen location.
await call('GET', `/schedules/week?locationId=${hafen.id}&date=${today}`, manager, null, 403);
// Employee must not list employees.
await call('GET', '/employees', employee, null, 403);

// Create a draft shift two weeks ahead, then update with a stale version.
const d = new Date(); d.setDate(d.getDate() + 14);
const date = d.toISOString().slice(0, 10);
const created = await call('POST', '/shifts', owner, {
  locationId: altstadt.id, jobRoleId: roles[0].id, employeeId: null, date, startTime: '10:00', endTime: '16:00', breakMinutes: 30, notes: 'Smoke-Test',
}, 201);
const shift = created.shift;
const updated = await call('PUT', `/shifts/${shift.id}`, owner, {
  locationId: altstadt.id, jobRoleId: roles[0].id, employeeId: null, date, startTime: '11:00', endTime: '17:00', breakMinutes: 30, notes: 'Smoke-Test', version: shift.version,
});
await call('PUT', `/shifts/${shift.id}`, owner, {
  locationId: altstadt.id, jobRoleId: roles[0].id, employeeId: null, date, startTime: '12:00', endTime: '17:00', breakMinutes: 30, version: shift.version,
}, 409);
await call('GET', `/schedules/validation?locationId=${altstadt.id}&date=${date}`, owner);
await call('DELETE', `/shifts/${shift.id}?version=${encodeURIComponent(updated.shift.version)}`, owner, null, 204);

// Employee views and requests.
await call('GET', '/dashboard/employee', employee);
const from = today; const to = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
await call('GET', `/shifts/mine?from=${from}&to=${to}`, employee);
const l1 = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
const leave = await call('POST', '/leave-requests', employee, { type: 'Vacation', startDate: l1, endDate: l1, note: 'Smoke' }, 201);
await call('POST', `/leave-requests/${leave.id}/approve`, employee, { version: leave.version }, 403);
await call('GET', `/leave-requests/${leave.id}/conflicts`, manager);
await call('POST', `/leave-requests/${leave.id}/reject`, manager, { version: leave.version, reason: 'Smoke-Test' });
await call('GET', '/shift-swaps?scope=mine', employee);
await call('GET', '/shift-swaps?scope=manage', owner);
await call('GET', '/notifications', employee);
await call('GET', '/notifications/unread-count', employee);
await call('GET', `/reports/scheduled-hours?from=${today}&to=${to}`, owner);
const csv = await fetch(`${api}/reports/scheduled-hours?from=${today}&to=${to}&format=csv`, { headers: { Authorization: `Bearer ${owner}` } });
console.log(`${csv.ok ? 'PASS' : 'FAIL'} CSV export -> ${csv.status} ${csv.headers.get('content-type')}`);
if (!csv.ok) failures++;
await call('GET', '/subscription', owner);
await call('GET', '/subscription', manager, null, 403);

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
