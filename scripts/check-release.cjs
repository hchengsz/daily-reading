const assert = require('node:assert/strict');
const config = require('../app.json').expo;

if (process.env.EAS_BUILD_PROFILE === 'testflight') {
  assert(config.ios?.bundleIdentifier, 'Set ios.bundleIdentifier in app.json before a TestFlight build.');
  assert(config.extra?.eas?.projectId, 'Link the project with eas init before a TestFlight build.');
  const origin = new URL(process.env.EXPO_PUBLIC_API_ORIGIN || 'http://localhost');
  assert(origin.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname),
    'Set EXPO_PUBLIC_API_ORIGIN to the deployed HTTPS backend in the EAS production environment.');
  assert(origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password,
    'EXPO_PUBLIC_API_ORIGIN must be an origin without a path, credentials, query or fragment.');
  console.log('TestFlight configuration checks passed.');
}
