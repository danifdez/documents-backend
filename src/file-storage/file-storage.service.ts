import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class FileStorageService {
  private readonly baseStoragePath: string;

  constructor(private readonly configService: ConfigService) {
    this.baseStoragePath = path.resolve(
      this.configService.get('DOCUMENTS_STORAGE_DIR') || path.join(__dirname, '..', '..', '..', 'documents'),
    );
    this.ensureDirectoryExists(this.baseStoragePath);
  }

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

  async fileExists(hash: string, extension: string): Promise<boolean> {
    try {
      return await fs.pathExists(this.getRelativePath(hash, extension));
    } catch {
      return false;
    }
  }

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

  getFilePath(relativePath: string): string {
    return path.join(this.baseStoragePath, relativePath);
  }

  async getFile(relativePath: string): Promise<Buffer | null> {
    try {
      const filePath = this.getFilePath(relativePath);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async deleteFile(relativePath: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(relativePath);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public calculateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private async ensureDirectoryExists(directory: string): Promise<void> {
    await fs.ensureDir(directory);
  }
}
