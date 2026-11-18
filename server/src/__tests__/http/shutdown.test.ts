import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

/** A server that answers slowly and calls stopOnSignals. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'slow-server.ts');

/** The fixture, with stdout and stderr readable. */
type Fixture = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Waits until the process has printed a line matching `pattern`.
 *
 * @param output - Everything the process has printed so far, kept up to date.
 * @param child - The process.
 * @param pattern - What to wait for.
 * @returns The match.
 */
function waitForLine(output: { text: string }, child: Fixture, pattern: RegExp): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      const match = output.text.match(pattern);
      if (match !== null) {
        child.stdout.off('data', check);
        resolve(match);
      }
    };
    child.stdout.on('data', check);
    child.once('exit', () => reject(new Error(`Exited before printing ${pattern}:\n${output.text}`)));
    check();
  });
}

describe('stopOnSignals', () => {
  it('lets the request in flight finish, closes, and exits 0 on SIGTERM', async () => {
    const child: Fixture = spawn(process.execPath, [FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { text: '' };
    child.stdout.on('data', (chunk: Buffer) => {
      output.text += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output.text += chunk.toString();
    });
    const exited = once(child, 'exit');

    const [, port] = await waitForLine(output, child, /listening on (\d+)/);
    const response = fetch(`http://127.0.0.1:${port}/`);
    await waitForLine(output, child, /request received/);
    child.kill('SIGTERM');

    expect(await (await response).text()).toBe('finished');
    const [code] = await exited;
    expect(code).toBe(0);
    const draining = output.text.indexOf('[server] SIGTERM: draining');
    const closed = output.text.indexOf('closed what requests used');
    const stopped = output.text.indexOf('[server] stopped');
    expect(draining).toBeGreaterThanOrEqual(0);
    expect(closed).toBeGreaterThan(draining);
    expect(stopped).toBeGreaterThan(closed);
  });
});
