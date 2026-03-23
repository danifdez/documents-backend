import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'knowledge_entries' })
export class KnowledgeEntryEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    title: string;

    @Column({ type: 'text', nullable: true })
    content: string | null;

    @Column({ type: 'text', nullable: true })
    summary: string | null;

    @Column({ type: 'jsonb', nullable: true })
    tags: string[] | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
