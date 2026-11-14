import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';

describe('Nest telemetry lifecycle', () => {
  it('exports metadata through the native Node runtime', async () => {
    // Exercise the SDK's dynamic imports outside Jest's VM, without changing
    // the project's test commands or replacing the real OTLP exporter.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        resolve(__dirname, '../../support/telemetry-lifecycle.probe.ts'),
      ],
      { cwd: resolve(__dirname, '../../..'), timeout: 15000 },
    );
    expect(JSON.parse(stdout)).toEqual({
      exported: true,
      contextsIsolated: true,
      privateContentAbsent: true,
    });
  }, 20000);
});
