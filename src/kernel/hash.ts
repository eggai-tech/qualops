import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function calculateFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

export async function calculateFileHashes(filePaths: string[]): Promise<Record<string, string>> {
  const hashPromises = filePaths.map(async (filePath) => {
    try {
      const hash = await calculateFileHash(filePath);
      return { filePath, hash };
    } catch {
      return { filePath, hash: null };
    }
  });

  const results = await Promise.all(hashPromises);
  const hashMap: Record<string, string> = {};

  for (const result of results) {
    if (result.hash) {
      hashMap[result.filePath] = result.hash;
    }
  }

  return hashMap;
}
