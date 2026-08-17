import { StorageAdapter } from './StorageAdapter.js';
import fs from 'fs';
import path from 'path';
import config from '../config.js';

export class LocalStorage extends StorageAdapter {
  constructor() {
    super();
    this.uploadDir = config.UPLOAD_DIR;
    if (!fs.existsSync(this.uploadDir)) fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async upload(file, subdir = '') {
    const dir = path.join(this.uploadDir, subdir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, file.buffer);
    return path.join(subdir, filename).replace(/\\/g, '/');
  }

  async delete(filePath) {
    const fullPath = path.join(this.uploadDir, filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  getUrl(filePath) {
    return `/uploads/${filePath}`;
  }
}

export default new LocalStorage();
