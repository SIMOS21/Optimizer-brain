// Graph-only benchmark: stored synthetic snapshots, dev React Profiler and
// projection timings. The harness HTML is not included in the production build.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { project } from "../frontend/src/features/graph/projection.ts";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium, request } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const stage = process.argv[2];
if (!['before', 'after'].includes(stage) || process.env.STUDIO_E2E !== '1' || new URL(process.env.BRAIN_DATABASE_URL).pathname !== '/optimizer_brain_e2e' || process.env.STUDIO_BASE_URL !== 'http://127.0.0.1:5181') throw new Error('Isolated E2E benchmark required');
const fixture = JSON.parse(await readFile(join(process.env.STUDIO_E2E_FIXTURES_DIR, 'factory.json'), 'utf8'));
const output = join(root, '.local/ux-f3', stage);
await mkdir(output, { recursive: true });
const api = await request.newContext({ baseURL: process.env.STUDIO_BASE_URL });
const browser = await chromium.launch({ headless: true });
let headers;
async function call(path, body) {
  const response = body === undefined ? await api.get(`/api/v1${path}`, { headers }) : await api.post(`/api/v1${path}`, { headers, data: body });
  if (!response.ok()) {
    const detail = path.endsWith('/graphs') ? (await response.json()).detail : undefined;
    const locations = Array.isArray(detail) ? detail.map(({ loc, msg }) => ({ loc, msg })) : typeof detail === 'string' ? detail : undefined;
    throw new Error(`Synthetic provisioning refused (${response.status()}): ${JSON.stringify(locations)}`);
  }
  return response.json();
}
async function list(path) {
  const result = [];
  for (let offset = 0; ; offset += 100) {
    const page = await call(`${path}?limit=100&offset=${offset}`);
    result.push(...page.items);
    if (page.items.length < 100) return result;
  }
}
try {
  const auth = await call('/auth/login', { username: 'studio_demo_admin', password: process.env.BRAIN_DEMO_PASSWORD });
  headers = { Authorization: `Bearer ${auth.access_token}` };
  const key = 'studio_import_ux_f3_benchmark';
  let org = (await list('/organizations')).find((item) => item.key === key);
  if (!org) org = await call('/organizations', { key, name: 'Mesures synthétiques UX-F3' });
  const base = `/organizations/${org.id}`;
  const registered = new Set((await list(`${base}/departments`)).map((item) => item.key));
  for (let index = 0; index < 100; index++) {
    const id = `bench_department_${String(index).padStart(3, '0')}`;
    if (!registered.has(id)) await call(`${base}/departments`, { key: id, name: `Département de mesure ${index + 1}` });
  }
  const existing = await list(`${base}/graphs`);
  const graphs = [];
  for (const count of [7, 50, 200]) {
    const doc = structuredClone(fixture.graph.document);
    doc.graph.organization = { ...doc.graph.organization, id: org.key, name: org.name, version: `measure_${count}_v1`, source: 'synthetic_ux_f3_benchmark', data_snapshot_id: `ux_f3_measure_${count}_v1` };
    const departmentCount = Math.ceil(count / 2);
    doc.graph.departments = Array.from({ length: departmentCount }, (_, index) => ({ ...fixture.graph.document.graph.departments[0], id: `bench_department_${String(index).padStart(3, '0')}`, name: `Département de mesure ${index + 1}`, owner_id: `responsable_declare_${index + 1}`, version: '1', source: 'synthetic_ux_f3_benchmark' }));
    doc.graph.resources = Array.from({ length: count - departmentCount }, (_, index) => ({ ...fixture.graph.document.graph.resources[0], id: `bench_resource_${String(index).padStart(3, '0')}`, name: `Ressource de mesure ${index + 1}`, owner_department: doc.graph.departments[index].id, shared_with: [], version: '1', source: 'synthetic_ux_f3_benchmark' }));
    doc.graph.edges = [
      ...doc.graph.resources.map((resource, index) => ({ id: `uses_${index}`, type: 'USES_RESOURCE', source_id: resource.owner_department, target_id: resource.id })),
      ...doc.graph.departments.slice(1).map((department, index) => ({ id: `depends_${index}`, type: 'DEPENDS_ON', source_id: department.id, target_id: doc.graph.departments[index].id })),
    ];
    let metadata = existing.find((item) => item.key === doc.graph.organization.id && item.version === doc.graph.organization.version);
    if (!metadata) metadata = await call(`${base}/graphs`, doc);
    if (metadata.state !== 'PUBLISHED') metadata = await call(`${base}/graphs/${metadata.id}/publish`, {});
    const record = await call(`${base}/graphs/${metadata.id}`);
    if (record.document.graph.departments.length + record.document.graph.resources.length !== count) throw new Error('Synthetic snapshot mismatch');
    graphs.push({ count, record });
  }
  const identities = graphs.map(({ count, record }) => ({ count, id: record.id, content_hash: record.content_hash, snapshot: record.document.graph.organization.data_snapshot_id }));
  const manifest = join(root, '.local/ux-f3/graphs.json');
  if (stage === 'after' && JSON.stringify(JSON.parse(await readFile(manifest, 'utf8'))) !== JSON.stringify(identities)) throw new Error('Before/after snapshot identities differ');
  await writeFile(manifest, JSON.stringify(identities, null, 2));
  const samples = [];
  for (const { count, record } of graphs) {
    for (let warm = 0; warm < 10; warm++) project(record.document);
    const projectionMs = [];
    for (let repeat = 0; repeat < 30; repeat++) { const begin = performance.now(); project(record.document); projectionMs.push(performance.now() - begin); }
    for (let sample = 0; sample < 3; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(`${process.env.STUDIO_BASE_URL}/benchmarks/graph.html`);
      await page.waitForFunction(() => !!window.graphBenchmark);
      const renderMs = await page.evaluate((doc) => { const begin = performance.now(); window.graphBenchmark.load(doc); return begin; }, record.document);
      await page.waitForFunction(({ count, edges }) => document.querySelectorAll('.react-flow__node').length === count && document.querySelectorAll('.react-flow__edge').length === edges && performance.now() - window.graphBenchmark.read().lastCommitAt > 100, { count, edges: record.document.graph.edges.length });
      const initial = await page.evaluate((begin) => ({ durationMs: performance.now() - begin, ...window.graphBenchmark.read() }), renderMs);
      const first = page.locator('.react-flow__node').first();
      await first.focus();
      await page.evaluate(() => window.graphBenchmark.reset());
      const selectAt = performance.now();
      await page.keyboard.press('Enter');
      await page.locator('.inspector').getByRole('heading', { name: record.document.graph.departments[0].name, exact: true }).waitFor();
      const selection = { durationMs: performance.now() - selectAt, ...await page.evaluate(() => window.graphBenchmark.read()) };
      if (sample === 0) await page.screenshot({ path: join(output, `graph-${count}-1440.png`), fullPage: true });
      samples.push({ count, sample, contentHash: record.content_hash, projectionMs, initial, selection });
      await context.close();
    }
  }
  const result = { stage, browser: browser.version(), node: process.version, protocol: 'React dev Profiler, immutable secured E2E snapshots; 3 fresh contexts per size; initial includes 100 ms quiet window; local measurements, no SLA', samples };
  await writeFile(join(output, 'measurements.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ stage, samples: samples.length, sizes: graphs.map((g) => g.count) }));
} finally {
  if (headers) await api.post('/api/v1/auth/logout', { headers });
  await api.dispose();
  await browser.close();
}
