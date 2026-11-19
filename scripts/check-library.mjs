import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardedApply } from 'agent-guard';

const directory = await mkdtemp(join(tmpdir(), 'agent-guard-'));
const target = join(directory, 'target.txt');
const backup = join(directory, 'backup.txt');

try {
  await writeFile(target, 'original');
  const result = await guardedApply({
    baseline: async () => {
      const original = await readFile(target, 'utf8');
      if (original !== 'original') return false;
      await writeFile(backup, original);
      return true;
    },
    apply: async () => {
      await writeFile(target, 'partial edit');
      throw new Error('Deployment stopped after the write');
    },
    rollback: async () => {
      assert.equal(await readFile(target, 'utf8'), 'partial edit');
      await writeFile(target, await readFile(backup));
    },
    verify: async (stage) => {
      assert.equal(stage, 'recovery');
      return (await readFile(target, 'utf8')) === 'original';
    },
  });
  assert.equal(result.outcome, 'recovered');
  assert.equal(result.failure.stage, 'apply');
  assert.equal(result.failure.kind, 'threw');
  assert.equal(await readFile(target, 'utf8'), 'original');
  console.log('Library restored and verified a partial write after apply failed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
