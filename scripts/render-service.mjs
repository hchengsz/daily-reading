// Node 24: node --env-file=.env.deployment.local scripts/render-service.mjs <mode> <service-id> [commit-or-branch]
const [mode, serviceId, revision] = process.argv.slice(2);
if (!['configure', 'deploy', 'status'].includes(mode) || !/^srv-[a-z0-9]+$/.test(serviceId || '')) {
  throw new Error('Expected configure|deploy|status and a Render service ID');
}
const token = process.env.RENDER_API_KEY;
if (!token) throw new Error('Missing RENDER_API_KEY');
const base = `https://api.render.com/v1/services/${serviceId}`;
async function request(suffix = '', method = 'GET', body) {
  const response = await fetch(base + suffix, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Render ${method} ${suffix || '/service'} failed (${response.status})`);
  return response.json();
}
const service = await request();
if (service.type !== 'web_service' || service.serviceDetails?.plan !== 'free' ||
    service.repo.replace(/\.git$/, '') !== 'https://github.com/hchengsz/daily-reading') {
  throw new Error('Expected this project’s existing free web service; refusing to change another service or plan.');
}
if (mode === 'configure') {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BACKEND_ACCESS_TOKEN', 'GEMINI_API_KEY', 'GEMINI_VOCAB_MODEL'];
  for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
  if (process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_publishable_')) throw new Error('Supabase requires a server key');
  const values = {
    ...Object.fromEntries(required.map((name) => [name, process.env[name]])),
    NODE_VERSION: '24.14.1', HOST: '0.0.0.0', STORAGE_PROVIDER: 'supabase',
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'daily-reading',
  };
  // Update only our keys; preserve unrelated environment configuration.
  for (const [name, value] of Object.entries(values)) {
    await request(`/env-vars/${encodeURIComponent(name)}`, 'PUT', { value });
  }
  await request('', 'PATCH', {
    autoDeploy: 'no', ...(revision ? { branch: revision } : {}),
    serviceDetails: {
      healthCheckPath: '/healthz',
      envSpecificDetails: { buildCommand: 'npm ci && npm run backend:build', startCommand: 'npm run backend:start' },
    },
  });
  console.log('Free service configured; backend credentials stored only in Render environment.');
} else if (mode === 'deploy') {
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Deploy requires an exact verified commit SHA');
  const result = await request('/deploys', 'POST', { commitId: revision, clearCache: 'do_not_clear' });
  console.log(JSON.stringify({ id: result.id, status: result.status, url: service.serviceDetails.url }));
} else {
  const deploys = await request('/deploys?limit=3');
  console.log(JSON.stringify({
    url: service.serviceDetails.url, plan: service.serviceDetails.plan,
    deploys: deploys.map(({ deploy }) => ({ id: deploy.id, status: deploy.status, commit: deploy.commit?.id })),
  }));
}
