import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeVectorSourceIds1757668140500 implements MigrationInterface {
  name = 'NormalizeVectorSourceIds1757668140500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE rag_chunks
      SET source_id = 'resource_' || source_id,
          payload = jsonb_set(
            payload,
            '{source_id}',
            to_jsonb('resource_' || source_id),
            true
          )
      WHERE source_type = 'resource'
        AND source_id ~ '^[0-9]+$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE rag_chunks
      SET source_id = substring(source_id FROM 10),
          payload = jsonb_set(
            payload,
            '{source_id}',
            to_jsonb(substring(source_id FROM 10)),
            true
          )
      WHERE source_type = 'resource'
        AND source_id ~ '^resource_[0-9]+$'
    `);
  }
}
