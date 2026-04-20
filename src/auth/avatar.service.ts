import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as sharp from 'sharp';
import { UserEntity } from './user.entity';
import { FileStorageService } from '../file-storage/file-storage.service';

const AVATAR_SIZE = 256;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@Injectable()
export class AvatarService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly storage: FileStorageService,
  ) {}

  async uploadAvatar(userId: number, file: Express.Multer.File): Promise<{ avatarPath: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File too large (max 5MB)');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image type');
    }

    let resized: Buffer;
    try {
      resized = await sharp(file.buffer)
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image file');
    }

    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (user.avatarPath) {
      await this.storage.deleteFile(user.avatarPath).catch(() => {});
    }

    const hash = this.storage.calculateHash(resized);
    const { relativePath } = await this.storage.storeFile(hash, resized, `avatar-${userId}.webp`);

    user.avatarPath = relativePath;
    await this.userRepo.save(user);

    return { avatarPath: relativePath };
  }

  async deleteAvatar(userId: number): Promise<void> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (!user.avatarPath) return;

    await this.storage.deleteFile(user.avatarPath).catch(() => {});
    user.avatarPath = null;
    await this.userRepo.save(user);
  }

  async getAvatarBuffer(userId: number): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user || !user.avatarPath) return null;
    const buffer = await this.storage.getFile(user.avatarPath);
    if (!buffer) return null;
    return { buffer, mimeType: 'image/webp' };
  }
}
