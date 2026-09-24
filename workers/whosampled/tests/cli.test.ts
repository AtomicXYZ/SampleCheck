import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
// Run the same CLI entry point without a shell, network access or database.
const run = (...args: string[]) => exec(process.execPath, ['--import', 'tsx', cli, ...args], { cwd: root });
const fixture = fileURLToPath(new URL('./fixtures/relation-multiple.html', import.meta.url));
const relationUrl = 'https://www.whosampled.com/sample/900001/Fixture/';

it('prints timestamp JSON on stdout', async () => {
  const { stdout, stderr } = await run('timestamps', 'Sample appears at 0:06 and 1:10');
  expect(JSON.parse(stdout).timestampsMs).toEqual([6000, 70000]);
  expect(stderr).toBe('');
});

it('prints offline relationship JSON', async () => {
  const { stdout } = await run('relation', relationUrl, '--html', fixture);
  expect(JSON.parse(stdout).source.timestamps.timestampsMs).toEqual([6000, 8000, 13000, 17000, 70000]);
});

it('exits nonzero with a structured error for invalid input', async () => {
  try {
    await run('timestamps', '0:99');
    throw new Error('Expected CLI failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 1, stdout: '' });
    expect(JSON.parse((error as { stderr: string }).stderr).error.code).toBe('TIMESTAMP_PARSE_FAILED');
  }
});

it('rejects --browser combined with --html before starting a browser', async () => {
  try {
    await run('relation', relationUrl, '--html', fixture, '--browser');
    throw new Error('Expected CLI failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 1, stdout: '' });
    expect(JSON.parse((error as { stderr: string }).stderr).error.code).toBe('INVALID_ARGUMENT');
  }
});

it('rejects --browser-executable without --browser', async () => {
  try {
    await run('relation', relationUrl, '--browser-executable', 'x');
    throw new Error('Expected CLI failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 1, stdout: '' });
    expect(JSON.parse((error as { stderr: string }).stderr).error.code).toBe('INVALID_ARGUMENT');
  }
});

it('writes a JSON artifact and refuses to overwrite it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'samplecheck-scraper-test-'));
  const output = join(directory, 'relation.json');
  try {
    await run('relation', relationUrl, '--html', fixture, '--out', output);
    const original = await readFile(output, 'utf8');
    expect(JSON.parse(original).whosampledRelationId).toBe('900001');
    await expect(run('timestamps', '0:06', '--out', output)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(output, 'utf8')).toBe(original);
  } finally {
    // Only remove the exact test file we created, then its now-empty directory.
    await rm(output, { force: true });
    await rmdir(directory);
  }
});
