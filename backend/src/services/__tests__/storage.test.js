// Regression tests for full audit 1.55 (services/storage.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cloud = vi.hoisted(() => ({
  lastOptions: null,
  destroy: null,
}));
let dbResults;

vi.mock('../../config/cloudinary.js', () => ({
  default: {
    uploader: {
      upload_stream: (options, cb) => {
        cloud.lastOptions = options;
        return { end: () => cb(null, { public_id: `${options.folder}/${options.public_id}`, secure_url: 'https://res.example/x' }) };
      },
      destroy: (...a) => cloud.destroy(...a),
    },
  },
}));

// Minimal chainable fake: every builder method returns the builder; awaiting
// it (or .single()) resolves to the next queued result for that table op.
vi.mock('../../config/supabase.js', () => {
  const make = (op) => {
    const b = {};
    for (const m of ['select', 'eq']) b[m] = () => b;
    b.single = () => Promise.resolve(dbResults[op]);
    b.then = (res, rej) => Promise.resolve(dbResults[op]).then(res, rej);
    return b;
  };
  return { default: { from: () => ({ insert: () => make('insert'), select: () => make('select'), delete: () => make('delete') }) } };
});

const { uploadFile, deleteFile } = await import('../storage.js');

beforeEach(() => {
  cloud.lastOptions = null;
  cloud.destroy = vi.fn().mockResolvedValue({ result: 'ok' });
  dbResults = { insert: { data: { id: 'f1' }, error: null }, select: { data: null, error: null }, delete: { error: null } };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const meta = (over = {}) => ({ originalFilename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 100, userId: 'u1', ...over });

describe('uploadFile', () => {
  it('uses an extension derived from the validated mime type, not the client filename', async () => {
    await uploadFile(Buffer.from('x'), meta({ originalFilename: 'evil.html' }));
    expect(cloud.lastOptions.resource_type).toBe('raw');
    expect(cloud.lastOptions.format).toBe('pdf');
  });

  it('maps text/plain and text/csv to txt and csv', async () => {
    await uploadFile(Buffer.from('x'), meta({ mimeType: 'text/plain', originalFilename: 'a.exe' }));
    expect(cloud.lastOptions.format).toBe('txt');
    await uploadFile(Buffer.from('x'), meta({ mimeType: 'text/csv', originalFilename: 'a.svg' }));
    expect(cloud.lastOptions.format).toBe('csv');
  });

  it('removes the Cloudinary object when the metadata insert fails (no orphan)', async () => {
    dbResults.insert = { data: null, error: { message: 'fk violation' } };
    await expect(uploadFile(Buffer.from('x'), meta())).rejects.toThrow('Metadata save failed: fk violation');
    expect(cloud.destroy).toHaveBeenCalledTimes(1);
    expect(cloud.destroy.mock.calls[0][0]).toMatch(/^u1\//);
    expect(cloud.destroy.mock.calls[0][1]).toEqual({ resource_type: 'raw' });
  });

  it('still reports the real error if orphan cleanup itself fails', async () => {
    dbResults.insert = { data: null, error: { message: 'boom' } };
    cloud.destroy = vi.fn().mockRejectedValue(new Error('cloudinary down'));
    await expect(uploadFile(Buffer.from('x'), meta())).rejects.toThrow('Metadata save failed: boom');
  });
});

describe('deleteFile', () => {
  it('rejects a file owned by someone else', async () => {
    dbResults.select = { data: { storage_path: 'p', resource_type: 'raw', user_id: 'other' }, error: null };
    await expect(deleteFile('f1', 'u1')).rejects.toThrow('File not found or access denied');
    expect(cloud.destroy).not.toHaveBeenCalled();
  });

  it('surfaces a failed row delete instead of reporting success', async () => {
    dbResults.select = { data: { storage_path: 'p', resource_type: 'raw', user_id: 'u1' }, error: null };
    dbResults.delete = { error: { message: 'db down' } };
    await expect(deleteFile('f1', 'u1')).rejects.toThrow('Metadata delete failed: db down');
  });

  it('succeeds for the owner when everything works', async () => {
    dbResults.select = { data: { storage_path: 'p', resource_type: 'raw', user_id: 'u1' }, error: null };
    await expect(deleteFile('f1', 'u1')).resolves.toBeUndefined();
  });
});
