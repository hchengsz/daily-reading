// Run with: node --env-file=.env.deployment.local scripts/prepare-cloud-storage.mjs
const origin = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'daily-reading';
if (!origin || !key || new URL(origin).protocol !== 'https:') throw new Error('Missing Supabase HTTPS URL or server key');
if (key.startsWith('sb_publishable_')) throw new Error('Use a server Secret key, not a publishable key.');
const base = `${origin.replace(/\/+$/, '')}/storage/v1/bucket`;
const headers = { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' };
const response = await fetch(`${base}/${encodeURIComponent(bucket)}`, {
  headers, signal: AbortSignal.timeout(30_000), redirect: 'error',
});
if (response.ok) {
  const existing = await response.json();
  if (existing.public !== false) throw new Error('Existing bucket is public. Choose a new private bucket instead.');
  console.log('Private storage bucket exists.');
} else {
  const error = await response.json().catch(() => ({}));
  const missing = error.code === 'NoSuchBucket' ||
    (error.error === 'not_found' && error.message === 'Bucket not found');
  if (!missing) throw new Error(`Cannot inspect bucket (${response.status}); verify the server key.`);
  const created = await fetch(base, {
    method: 'POST', headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 50 * 1024 * 1024 }),
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!created.ok) throw new Error(`Cannot create private bucket (${created.status}).`);
  console.log('Private storage bucket created.');
}
