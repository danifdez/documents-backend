import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { AssistantMessageEntity } from './assistant-message.entity';

@Entity({ name: 'assistants' })
export class AssistantEntity {
  @PrimaryColumn({ type: 'integer', default: 1 })
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 16, nullable: true })
  icon: string | null;

  @Column({ length: 300, nullable: true })
  sub: string | null;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @OneToMany(() => AssistantMessageEntity, (msg) => msg.assistant)
  messages: AssistantMessageEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
