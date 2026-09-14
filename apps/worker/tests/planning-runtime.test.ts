import assert from 'node:assert/strict';
import test from 'node:test';

test('worker runtime can import the Task Lane bridge and handoff writer', async () => {
  const planning = await import('@task-lane/planning');
  assert.equal(typeof planning.TaskLanePlanFeatureRunner, 'function');
  assert.equal(typeof planning.writePlanFeatureHandoff, 'function');
});
