import 'reflect-metadata';
import { ExecutionProtocolController } from '../../../src/execution/execution-protocol.controller';

describe('ExecutionProtocolController throttling', () => {
  const skipMetadata = 'THROTTLER:SKIPdefault';

  it('exempts only high-frequency authenticated lease maintenance routes', () => {
    const prototype = ExecutionProtocolController.prototype;

    expect(Reflect.getMetadata(skipMetadata, prototype.renewLease)).toBe(true);
    expect(Reflect.getMetadata(skipMetadata, prototype.control)).toBe(true);
    expect(Reflect.getMetadata(skipMetadata, prototype.claim)).toBeUndefined();
    expect(
      Reflect.getMetadata(skipMetadata, prototype.register),
    ).toBeUndefined();
    expect(Reflect.getMetadata(skipMetadata, prototype.result)).toBeUndefined();
  });
});
