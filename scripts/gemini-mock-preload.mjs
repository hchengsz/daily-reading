// Test-only transport: no request may leave the local integration-test process.
import { MockAgent, setGlobalDispatcher } from 'undici';

const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);
const pool = agent.get('https://generativelanguage.googleapis.com');
const key = 'test-personal-key-1234567890';
pool.intercept({ path: '/v1beta/models/gemini-test', method: 'GET', headers: { 'x-goog-api-key': key } })
  .reply(200, { supportedGenerationMethods: ['generateContent'] }).persist();
pool.intercept({ path: '/v1beta/models/gemini-denied', method: 'GET' })
  .reply(403, { error: { message: 'raw-secret-must-not-escape' } }).persist();
pool.intercept({ path: '/v1beta/models/gemini-busy', method: 'GET' })
  .reply(429, { error: { message: 'quota' } }).persist();
pool.intercept({ path: '/v1beta/models/gemini-test:generateContent', method: 'POST', headers: { 'x-goog-api-key': key } })
  .reply(200, (options) => {
    const body = JSON.parse(options.body);
    const text = body.generationConfig.responseMimeType === 'application/json'
      ? JSON.stringify({ pages: [{ page: 1, text: 'Mock corrected page' }] }) : 'Mock generated reading aid';
    return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
  }).persist();
