import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { logger } from '../../../shared/utils/logger';

export interface BackupMetadata {
  originalFile: string;
  backupFile: string;
  timestamp: string;
  size: number;
  checksum: string;
}

export interface BackupInfo {
  path: string;
  timestamp: Date;
  originalFile: string;
  size: number;
}

export async function createBackup(filePath: string, content?: string): Promise<string> {
  try {
    // Read content if not provided
    const fileContent = content || (await readFile(filePath, 'utf-8'));

    // Generate backup filename
    const timestamp = Date.now();
    const randomSuffix = randomBytes(6).toString('hex');
    const backupPath = `${filePath}.qualops-backup-${timestamp}-${randomSuffix}`;

    // Write backup
    await writeFile(backupPath, fileContent, 'utf-8');

    logger.info(`Created backup: ${backupPath}`);
    return backupPath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create backup for ${filePath}: ${errorMessage}`);
    throw new Error(`Backup creation failed: ${errorMessage}`);
  }
}

export async function createBackupWithMetadata(filePath: string): Promise<BackupMetadata> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    const checksum = await calculateChecksum(content);

    const backupPath = await createBackup(filePath, content);

    const metadata: BackupMetadata = {
      originalFile: filePath,
      backupFile: backupPath,
      timestamp: new Date().toISOString(),
      size: stats.size,
      checksum,
    };

    // Save metadata file alongside backup
    const metadataPath = `${backupPath}.metadata.json`;
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return metadata;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create backup with metadata for ${filePath}: ${errorMessage}`);
    throw new Error(`Backup with metadata creation failed: ${errorMessage}`);
  }
}

export async function restoreFromBackup(backupPath: string, targetPath?: string): Promise<void> {
  try {
    // Determine target path
    const restoreTarget = targetPath || extractOriginalPathFromBackup(backupPath);
    if (!restoreTarget) {
      throw new Error('Cannot determine original file path from backup name');
    }

    // Read backup content
    const backupContent = await readFile(backupPath, 'utf-8');

    // Restore the file
    await writeFile(restoreTarget, backupContent, 'utf-8');

    logger.info(`Restored ${restoreTarget} from backup ${backupPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to restore from backup ${backupPath}: ${errorMessage}`);
    throw new Error(`Restore failed: ${errorMessage}`);
  }
}

function extractOriginalPathFromBackup(backupPath: string): string | null {
  // Remove .qualops-backup-timestamp-random suffix
  const match = backupPath.match(/^(.+)\.qualops-backup-\d+-[a-z0-9]+$/);
  return match ? match[1] : null;
}

export async function listBackupsForFile(filePath: string): Promise<BackupInfo[]> {
  try {
    const directory = dirname(filePath);
    const filename = basename(filePath);

    const files = await readdir(directory);
    const backupFiles = files.filter(
      (file) => file.startsWith(`${filename}.qualops-backup-`) && !file.endsWith('.metadata.json'),
    );

    const backups: BackupInfo[] = [];

    for (const backupFile of backupFiles) {
      const backupPath = join(directory, backupFile);

      try {
        const stats = await stat(backupPath);

        // Extract timestamp from filename
        const timestampMatch = backupFile.match(/\.qualops-backup-(\d+)-/);
        const timestamp = timestampMatch ? new Date(parseInt(timestampMatch[1])) : stats.mtime;

        backups.push({
          path: backupPath,
          timestamp,
          originalFile: filePath,
          size: stats.size,
        });
      } catch (error) {
        logger.warn(`Could not read backup file ${backupPath}: ${error}`);
      }
    }

    // Sort by timestamp (newest first)
    backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return backups;
  } catch (error) {
    logger.error(`Failed to list backups for ${filePath}: ${error}`);
    return [];
  }
}

export async function listAllBackups(directory: string): Promise<BackupInfo[]> {
  try {
    const files = await readdir(directory);
    const backupFiles = files.filter((file) => file.includes('.qualops-backup-') && !file.endsWith('.metadata.json'));

    const backups: BackupInfo[] = [];

    for (const backupFile of backupFiles) {
      const backupPath = join(directory, backupFile);
      const originalFile = extractOriginalPathFromBackup(backupPath);

      if (!originalFile) continue;

      try {
        const stats = await stat(backupPath);

        // Extract timestamp from filename
        const timestampMatch = backupFile.match(/\.qualops-backup-(\d+)-/);
        const timestamp = timestampMatch ? new Date(parseInt(timestampMatch[1])) : stats.mtime;

        backups.push({
          path: backupPath,
          timestamp,
          originalFile,
          size: stats.size,
        });
      } catch (error) {
        logger.warn(`Could not read backup file ${backupPath}: ${error}`);
      }
    }

    // Sort by timestamp (newest first)
    backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return backups;
  } catch (error) {
    logger.error(`Failed to list backups in ${directory}: ${error}`);
    return [];
  }
}

export async function cleanupOldBackups(
  directory: string,
  keepPerFile = 5,
  maxAgeDays = 30,
): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0;
  const errors: string[] = [];

  try {
    const allBackups = await listAllBackups(directory);

    // Group backups by original file
    const backupsByFile = new Map<string, BackupInfo[]>();
    for (const backup of allBackups) {
      const file = backup.originalFile;
      if (!backupsByFile.has(file)) {
        backupsByFile.set(file, []);
      }
      const fileBackups = backupsByFile.get(file);
      if (fileBackups) {
        fileBackups.push(backup);
      }
    }

    const maxAge = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    // Process each file's backups
    for (const [_originalFile, fileBackups] of backupsByFile) {
      // Sort by timestamp (newest first)
      fileBackups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Keep the most recent backups, delete the rest
      const toDelete = fileBackups.slice(keepPerFile);

      // Also delete backups older than maxAge
      const oldBackups = fileBackups.filter((backup) => backup.timestamp < maxAge);

      const backupsToDelete = new Set([...toDelete, ...oldBackups]);

      for (const backup of backupsToDelete) {
        try {
          await unlink(backup.path);

          // Also delete metadata file if it exists
          const metadataPath = `${backup.path}.metadata.json`;
          try {
            await unlink(metadataPath);
          } catch {
            // Metadata file might not exist, that's okay
          }

          deleted++;
          logger.debug(`Deleted backup: ${backup.path}`);
        } catch (error) {
          const errorMessage = `Failed to delete ${backup.path}: ${error}`;
          errors.push(errorMessage);
          logger.warn(errorMessage);
        }
      }
    }

    logger.info(`Deleted ${deleted} old backups from ${directory}`);
  } catch (error) {
    const errorMessage = `Failed to cleanup backups in ${directory}: ${error}`;
    errors.push(errorMessage);
    logger.error(errorMessage);
  }

  return { deleted, errors };
}

export async function verifyBackup(backupPath: string): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  try {
    // Check if backup file exists
    await stat(backupPath);

    // Check if we can read the backup
    await readFile(backupPath, 'utf-8');

    // Check metadata if it exists
    const metadataPath = `${backupPath}.metadata.json`;
    try {
      const metadataContent = await readFile(metadataPath, 'utf-8');
      const metadata: BackupMetadata = JSON.parse(metadataContent);

      // Verify checksum if available
      if (metadata.checksum) {
        const backupContent = await readFile(backupPath, 'utf-8');
        const currentChecksum = await calculateChecksum(backupContent);

        if (currentChecksum !== metadata.checksum) {
          errors.push('Backup checksum mismatch - file may be corrupted');
        }
      }
    } catch {
      // Metadata file doesn't exist or is invalid, but that's not necessarily an error
    }
  } catch (error) {
    errors.push(`Cannot access backup file: ${error}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function calculateChecksum(content: string): Promise<string> {
  // Simple checksum using content length and a hash of first/last chars
  const length = content.length;
  const firstChars = content.substring(0, 100);
  const lastChars = content.substring(Math.max(0, content.length - 100));

  // Simple hash function
  let hash = 0;
  const combined = firstChars + lastChars + length;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return `${length}-${hash.toString(36)}`;
}

export async function createNamedBackup(filePath: string, backupName: string, content?: string): Promise<string> {
  try {
    // Read content if not provided
    const fileContent = content || (await readFile(filePath, 'utf-8'));

    // Generate backup filename with custom name
    const timestamp = Date.now();
    const backupPath = `${filePath}.qualops-backup-${backupName}-${timestamp}`;

    // Write backup
    await writeFile(backupPath, fileContent, 'utf-8');

    logger.info(`Created named backup: ${backupPath}`);
    return backupPath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create named backup for ${filePath}: ${errorMessage}`);
    throw new Error(`Named backup creation failed: ${errorMessage}`);
  }
}
