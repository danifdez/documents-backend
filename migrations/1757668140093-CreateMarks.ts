import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMarks1757668140093 implements MigrationInterface {
    name = 'CreateMarks1757668140093'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "marks" ("id" SERIAL NOT NULL, "content" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "docId" integer, CONSTRAINT "PK_051deeb008f7449216d568872c6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "marks" ADD CONSTRAINT "FK_47671e6f52aed8613d4387e9a94" FOREIGN KEY ("docId") REFERENCES "docs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "marks" DROP CONSTRAINT "FK_47671e6f52aed8613d4387e9a94"`);
        await queryRunner.query(`DROP TABLE "marks"`);
    }

}
