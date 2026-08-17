export class StorageAdapter {
  async upload(file, subdir = '') { throw new Error('Not implemented'); }
  async delete(filePath) { throw new Error('Not implemented'); }
  getUrl(filePath) { throw new Error('Not implemented'); }
}
