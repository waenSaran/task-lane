import assert from 'node:assert/strict';
import test from 'node:test';

test('redacts bearer tokens, auth headers, sensitive assignments, and configured literals', async () => {
  const mod = await import('../dist/index.js');
  assert.equal(typeof mod.redactSecrets, 'function', 'redactSecrets export must exist');
  const input = [
    'Authorization: Bearer abc.def.ghi',
    'PLANE_API_KEY=plane-secret',
    'token: ghp_supersecret',
    'literal custom-secret',
  ].join('\n');
  const output = mod.redactSecrets(input, ['custom-secret']);
  assert.equal(output.includes('abc.def.ghi'), false);
  assert.equal(output.includes('plane-secret'), false);
  assert.equal(output.includes('ghp_supersecret'), false);
  assert.equal(output.includes('custom-secret'), false);
  assert.match(output, /\[REDACTED\]/);
});
