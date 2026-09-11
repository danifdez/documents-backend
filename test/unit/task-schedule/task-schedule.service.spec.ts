import * as os from 'os';
import { TaskScheduleService } from '../../../src/task-schedule/task-schedule.service';

describe('TaskScheduleService', () => {
  function buildService() {
    const coordinator = {
      prepareAgentWork: jest.fn().mockResolvedValue(0),
      acceptResults: jest.fn().mockResolvedValue(0),
      publishNotifications: jest.fn().mockResolvedValue(0),
      finalizeReady: jest.fn().mockResolvedValue(0),
      executeReadyTools: jest.fn().mockResolvedValue(0),
      recoverStaleToolEffects: jest.fn().mockResolvedValue(0),
      expireConfirmations: jest.fn().mockResolvedValue(0),
      recoverStaleFinalizations: jest.fn().mockResolvedValue(0),
    };
    const workers = {
      markStaleOffline: jest.fn().mockResolvedValue(0),
    };
    const attempts = {
      expireStaleAttempts: jest.fn().mockResolvedValue(0),
    };
    const service = new TaskScheduleService(
      coordinator as any,
      workers as any,
      attempts as any,
    );
    return { service, coordinator, workers, attempts };
  }

  it('finalizes accepted results even under resource pressure', async () => {
    const { service, coordinator } = buildService();
    jest.spyOn(service as any, 'getCPUAndMemoryUsage').mockReturnValue({
      cpuUsagePercent: 10,
      memoryUsagePercent: 90,
      heapUsed: 100,
    });

    await service.handleCron();

    expect(coordinator.finalizeReady).toHaveBeenCalledTimes(1);
    expect(coordinator.publishNotifications).toHaveBeenCalledTimes(1);
    expect(coordinator.executeReadyTools).not.toHaveBeenCalled();
    expect(coordinator.finalizeReady.mock.invocationCallOrder[0]).toBeLessThan(
      coordinator.publishNotifications.mock.invocationCallOrder[0],
    );
  });

  it('uses memory available to the process instead of raw free memory', () => {
    const { service } = buildService();
    const availableMemory = jest
      .spyOn(process, 'availableMemory')
      .mockReturnValue(300);
    const totalMemory = jest.spyOn(os, 'totalmem').mockReturnValue(1000);

    const usage = (service as any).getCPUAndMemoryUsage();

    expect(usage.memoryUsagePercent).toBe(70);
    availableMemory.mockRestore();
    totalMemory.mockRestore();
  });

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
