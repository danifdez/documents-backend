import { Injectable } from '@nestjs/common';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class FileStorageService {
  private readonly baseStoragePath = '/app/documents_storage';

  constructor() {
    this.ensureDirectoryExists(this.baseStoragePath);
  }

  /**
   * Store a file with SHA256 hashing and directory structure
   * @param file The file buffer to store
   * @param originalFilename Original filename to extract extension
   * @returns Information about the stored file
   */
  async storeFile(
    hash: string,
    file: Buffer,
    originalFilename: string,
  ): Promise<{
    hash: string;
    relativePath: string;
    extension: string;
  }> {
    const extension = path.extname(originalFilename);

    const firstDir = hash.substring(0, 3);
    const secondDir = hash.substring(3, 6);
    const fullPath = path.join(this.baseStoragePath, firstDir, secondDir);

    await this.ensureDirectoryExists(fullPath);

    const relativePath = this.getRelativePath(hash, extension);

    await fs.writeFile(`${this.baseStoragePath}/${relativePath}`, file);

    return {
      hash,
      relativePath,
      extension,
    };
  }

  /**
   * Check if a file exists by its hash
   * @param hash The SHA256 hash of the file
   * @param extension The file extension
   * @returns True if the file exists, otherwise false
   */
  async fileExists(hash: string, extension: string): Promise<boolean> {
    try {
      return await fs.pathExists(this.getRelativePath(hash, extension));
    } catch {
      return false;
    }
  }

  /**
   * Generate the relative path for a file based on its hash
   * @param hash The SHA256 hash of the file
   * @param extension The file extension
   * @returns The relative path for the file
   */
  public getRelativePath(hash: string, extension: string): string {
    const firstDir = hash.substring(0, 3);
    const secondDir = hash.substring(3, 6);
    const finalFilename = `${hash}${extension}`;
    return path.join(firstDir, secondDir, finalFilename);
  }

  public getFullPath(hash: string, extension: string): string {
    return path.join(
      this.baseStoragePath,
      this.getRelativePath(hash, extension),
    );
  }

  /**
   * Get the full path to a stored file from its relative path
   * @param relativePath The relative path stored in the database
   * @returns The full path to the file
   */
  getFilePath(relativePath: string): string {
    return path.join(this.baseStoragePath, relativePath);
  }

  /**
   * Retrieve a file as a buffer from storage
   * @param relativePath The relative path stored in the database
   * @returns The file buffer or null if not found
   */
  async getFile(relativePath: string): Promise<Buffer | null> {
    try {
      const filePath = this.getFilePath(relativePath);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Delete a file from storage
   * @param relativePath The relative path stored in the database
   */
  async deleteFile(relativePath: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(relativePath);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calculate SHA256 hash of a buffer
   * @param buffer The buffer to hash
   * @returns The SHA256 hash as a hex string
   */
  public calculateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param directory The directory path to ensure
   */
  private async ensureDirectoryExists(directory: string): Promise<void> {
    await fs.ensureDir(directory);
  }
}
