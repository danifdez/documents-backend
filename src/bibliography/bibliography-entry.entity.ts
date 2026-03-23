import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { ResourceEntity } from '../resource/resource.entity';

export interface BibliographyCreator {
  creatorType: string; // 'author' | 'editor' | 'translator' | 'seriesEditor' | etc.
  firstName?: string;
  lastName?: string;
  name?: string; // for institutional authors
}

// Supported item types:
// journalArticle, book, bookSection, conferencePaper, thesis, report, webpage,
// magazineArticle, newspaperArticle, encyclopediaArticle, dictionaryEntry,
// audioRecording, videoRecording, film, tvBroadcast, radioBroadcast, podcast,
// interview, artwork, map, statute, bill, case, hearing, patent, email,
// instantMessage, forumPost, blogPost, document, presentation, software, dataset, misc

@Entity({ name: 'bibliography_entries' })
export class BibliographyEntryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProjectEntity, { nullable: true, onDelete: 'SET NULL' })
  project: ProjectEntity | null;

  @Column({ name: 'entry_type', default: 'misc' })
  entryType: string;

  @Column({ name: 'cite_key', nullable: true })
  citeKey: string | null;

  // --- Core fields ---
  @Column({ nullable: true })
  title: string | null;

  @Column({ name: 'short_title', nullable: true })
  shortTitle: string | null;

  @Column({ type: 'json', nullable: true })
  creators: BibliographyCreator[] | null;

  @Column({ nullable: true })
  year: string | null;

  @Column({ type: 'text', nullable: true })
  abstract: string | null;

  // --- Publication info ---
  @Column({ nullable: true })
  journal: string | null;

  @Column({ name: 'journal_abbreviation', nullable: true })
  journalAbbreviation: string | null;

  @Column({ nullable: true })
  booktitle: string | null;

  @Column({ name: 'conference_name', nullable: true })
  conferenceName: string | null;

  @Column({ nullable: true })
  volume: string | null;

  @Column({ nullable: true })
  number: string | null;

  @Column({ nullable: true })
  pages: string | null;

  @Column({ nullable: true })
  publisher: string | null;

  @Column({ nullable: true })
  place: string | null;

  @Column({ nullable: true })
  edition: string | null;

  @Column({ nullable: true })
  series: string | null;

  @Column({ name: 'series_number', nullable: true })
  seriesNumber: string | null;

  @Column({ name: 'number_of_volumes', nullable: true })
  numberOfVolumes: string | null;

  @Column({ name: 'number_of_pages', nullable: true })
  numberOfPages: string | null;

  // --- Identifiers ---
  @Column({ nullable: true })
  doi: string | null;

  @Column({ nullable: true })
  isbn: string | null;

  @Column({ nullable: true })
  issn: string | null;

  // --- Web / access ---
  @Column({ nullable: true })
  url: string | null;

  @Column({ name: 'access_date', nullable: true })
  accessDate: string | null;

  @Column({ name: 'website_title', nullable: true })
  websiteTitle: string | null;

  @Column({ name: 'website_type', nullable: true })
  websiteType: string | null;

  // --- Institution / thesis / report ---
  @Column({ nullable: true })
  institution: string | null;

  @Column({ nullable: true })
  university: string | null;

  @Column({ name: 'thesis_type', nullable: true })
  thesisType: string | null;

  @Column({ name: 'report_number', nullable: true })
  reportNumber: string | null;

  @Column({ name: 'report_type', nullable: true })
  reportType: string | null;

  // --- Archive / library ---
  @Column({ nullable: true })
  archive: string | null;

  @Column({ name: 'archive_location', nullable: true })
  archiveLocation: string | null;

  @Column({ name: 'call_number', nullable: true })
  callNumber: string | null;

  // --- Other ---
  @Column({ nullable: true })
  language: string | null;

  @Column({ nullable: true })
  rights: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  extra: string | null;

  @Column({ name: 'extra_fields', type: 'json', nullable: true })
  extraFields: Record<string, string> | null;

  @ManyToOne(() => ResourceEntity, { nullable: true, onDelete: 'SET NULL' })
  sourceResource: ResourceEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
