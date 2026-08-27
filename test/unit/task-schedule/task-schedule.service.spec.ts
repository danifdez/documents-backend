import { TaskScheduleService } from '../../../src/task-schedule/task-schedule.service';

describe('TaskScheduleService', () => {
  it('reconciles local effects before generic lease expiry', async () => {
    const coordinator = {
      recoverStaleToolEffects: jest.fn().mockResolvedValue(1),
      expireConfirmations: jest.fn().mockResolvedValue(0),
      recoverStaleFinalizations: jest.fn().mockResolvedValue(0),
    };
    const workers = {
      markStaleOffline: jest.fn().mockResolvedValue(0),
    };
    const attempts = {
      expireStaleAttempts: jest.fn().mockResolvedValue(1),
    };
    const service = new TaskScheduleService(
      coordinator as any,
      workers as any,
      attempts as any,
    );

    await service.handleStaleRecovery();

    expect(coordinator.recoverStaleToolEffects).toHaveBeenCalledTimes(1);
    expect(attempts.expireStaleAttempts).toHaveBeenCalledTimes(1);
    expect(
      coordinator.recoverStaleToolEffects.mock.invocationCallOrder[0],
    ).toBeLessThan(attempts.expireStaleAttempts.mock.invocationCallOrder[0]);
  });
});
