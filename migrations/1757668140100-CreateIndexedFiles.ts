import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIndexedFiles1757668140100 implements MigrationInterface {
  name = 'CreateIndexedFiles1757668140100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "indexed_files" (
                "id" SERIAL PRIMARY KEY,
                "owner_type" character varying(20) NOT NULL,
                "owner_id" integer NOT NULL,
                "filename" character varying(500) NOT NULL,
                "file_path" character varying(1000) NOT NULL,
                "mime_type" character varying(200) NOT NULL,
                "size" bigint NOT NULL,
                "mtime" TIMESTAMP NOT NULL,
                "checksum" character varying(128) NOT NULL,
                "extracted_text" text,
                "embedding_id" character varying(200),
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_indexed_files_owner_filename" UNIQUE ("owner_type", "owner_id", "filename"),
                CONSTRAINT "UQ_indexed_files_file_path" UNIQUE ("file_path"),
                CONSTRAINT "CHK_indexed_files_agent_owner" CHECK ("owner_type" = 'agent')
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_indexed_files_owner" ON "indexed_files" ("owner_type", "owner_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_indexed_files_owner"`);
    await queryRunner.query(`DROP TABLE "indexed_files"`);
  }
}
