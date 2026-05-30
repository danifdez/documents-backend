import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameMemoryEventToEpisode1757668140180 implements MigrationInterface {
  name = 'RenameMemoryEventToEpisode1757668140180';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "assistant_memory_entries" SET "type" = 'episode' WHERE "type" = 'event'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "assistant_memory_entries" SET "type" = 'event' WHERE "type" = 'episode'`,
    );
  }
}
