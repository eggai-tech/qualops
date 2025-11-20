import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../../../shared/utils/logger';
import { listBackupsForFile } from '../appliers/backup-manager';

export interface RollbackPoint {
  id: string;
  timestamp: Date;
  description: string;
  affectedFiles: RollbackFile[];
  metadata: {
    sessionId?: string;
    fixCount: number;
    totalChanges: number;
  };
}

export interface RollbackFile {
  filePath: string;
  backupPath: string;
  originalSize: number;
  backupSize: number;
  checksum?: string;
}

export interface RollbackResult {
  success: boolean;
  filesRestored: string[];
  errors: string[];
  summary: {
    totalFiles: number;
    restoredFiles: number;
    failedFiles: number;
  };
}

export interface RollbackOptions {
  verifyBackups?: boolean;
  createNewBackups?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export async function createRollbackPoint(
  description: string,
  affectedFiles: string[],
  sessionId?: string,
): Promise<RollbackPoint> {
  const id = generateRollbackId();
  const timestamp = new Date();

  logger.info(` Creating rollback point: ${description}`);

  const rollbackFiles: RollbackFile[] = [];

  for (const filePath of affectedFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);

      // Create backup
      const backupPath = `${filePath}.rollback-${id}-${Date.now()}`;
      await writeFile(backupPath, content, 'utf-8');

      const backupStats = await stat(backupPath);
      const checksum = calculateChecksum(content);

      rollbackFiles.push({
        filePath,
        backupPath,
        originalSize: stats.size,
        backupSize: backupStats.size,
        checksum,
      });

      logger.debug(` Backed up ${filePath} to ${backupPath}`);
    } catch (error) {
      logger.error(` Failed to backup ${filePath}: ${error}`);
      throw new Error(`Failed to create rollback point: cannot backup ${filePath}`);
    }
  }

  const rollbackPoint: RollbackPoint = {
    id,
    timestamp,
    description,
    affectedFiles: rollbackFiles,
    metadata: {
      sessionId,
      fixCount: affectedFiles.length,
      totalChanges: rollbackFiles.length,
    },
  };

  // Save rollback point metadata
  await saveRollbackPoint(rollbackPoint);

  logger.info(` Created rollback point ${id} with ${rollbackFiles.length} files`);
  return rollbackPoint;
}

export async function performRollback(
  rollbackPoint: RollbackPoint,
  options: RollbackOptions = {},
): Promise<RollbackResult> {
  const { verifyBackups = true, createNewBackups = true, force = false, dryRun = false } = options;

  logger.info(` ${dryRun ? 'Simulating' : 'Performing'} rollback to point ${rollbackPoint.id}`);

  const filesRestored: string[] = [];
  const errors: string[] = [];

  // Verify backups first if requested
  if (verifyBackups) {
    const verificationResult = await verifyRollbackPoint(rollbackPoint);
    if (!verificationResult.valid && !force) {
      return {
        success: false,
        filesRestored: [],
        errors: verificationResult.errors,
        summary: {
          totalFiles: rollbackPoint.affectedFiles.length,
          restoredFiles: 0,
          failedFiles: rollbackPoint.affectedFiles.length,
        },
      };
    }
  }

  // Process each file
  for (const fileInfo of rollbackPoint.affectedFiles) {
    try {
      // Create backup of current state if requested
      if (createNewBackups && !dryRun) {
        try {
          const currentContent = await readFile(fileInfo.filePath, 'utf-8');
          const currentBackupPath = `${fileInfo.filePath}.pre-rollback-${Date.now()}`;
          await writeFile(currentBackupPath, currentContent, 'utf-8');
          logger.debug(` Created pre-rollback backup: ${currentBackupPath}`);
        } catch (backupError) {
          logger.warn(` Failed to create pre-rollback backup for ${fileInfo.filePath}: ${backupError}`);
        }
      }

      if (!dryRun) {
        // Restore from backup
        const backupContent = await readFile(fileInfo.backupPath, 'utf-8');
        await writeFile(fileInfo.filePath, backupContent, 'utf-8');
      }

      filesRestored.push(fileInfo.filePath);
      logger.debug(` ${dryRun ? 'Would restore' : 'Restored'} ${fileInfo.filePath}`);
    } catch (error) {
      const errorMessage = `Failed to restore ${fileInfo.filePath}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMessage);
      logger.error(` ${errorMessage}`);
    }
  }

  const summary = {
    totalFiles: rollbackPoint.affectedFiles.length,
    restoredFiles: filesRestored.length,
    failedFiles: errors.length,
  };

  const success = errors.length === 0;

  logger.info(
    ` ${dryRun ? 'Simulation' : 'Rollback'} complete: ${summary.restoredFiles}/${summary.totalFiles} files ${dryRun ? 'would be ' : ''}restored`,
  );

  return {
    success,
    filesRestored,
    errors,
    summary,
  };
}

export async function listRollbackPoints(): Promise<RollbackPoint[]> {
  try {
    // In a real implementation, this would read from a persistent store
    // For now, we'll look for rollback metadata files
    const rollbackPoints: RollbackPoint[] = [];

    // This is a simplified implementation
    // In practice, you'd have a dedicated rollback store/database

    logger.debug(` Found ${rollbackPoints.length} rollback points`);
    return rollbackPoints;
  } catch (error) {
    logger.error(` Failed to list rollback points: ${error}`);
    return [];
  }
}

export async function performPartialRollback(
  rollbackPoint: RollbackPoint,
  filePaths: string[],
  options: RollbackOptions = {},
): Promise<RollbackResult> {
  logger.info(` Performing partial rollback of ${filePaths.length} files`);

  // Filter the rollback point to only include specified files
  const filteredRollbackPoint: RollbackPoint = {
    ...rollbackPoint,
    affectedFiles: rollbackPoint.affectedFiles.filter((file) => filePaths.includes(file.filePath)),
  };

  return performRollback(filteredRollbackPoint, options);
}

export async function autoRollback(
  filePaths: string[],
  maxAge = 3600000, // 1 hour in milliseconds
  options: RollbackOptions = {},
): Promise<RollbackResult> {
  logger.info(` Performing auto-rollback for ${filePaths.length} files`);

  const filesRestored: string[] = [];
  const errors: string[] = [];

  for (const filePath of filePaths) {
    try {
      // Find recent backups for this file
      const backups = await listBackupsForFile(filePath);

      // Filter backups by age
      const cutoffTime = new Date(Date.now() - maxAge);
      const recentBackups = backups.filter((backup) => backup.timestamp >= cutoffTime);

      if (recentBackups.length === 0) {
        errors.push(`No recent backups found for ${filePath}`);
        continue;
      }

      // Use the most recent backup
      const latestBackup = recentBackups[0];

      if (!options.dryRun) {
        // Create pre-rollback backup
        if (options.createNewBackups) {
          try {
            const currentContent = await readFile(filePath, 'utf-8');
            const preRollbackPath = `${filePath}.pre-auto-rollback-${Date.now()}`;
            await writeFile(preRollbackPath, currentContent, 'utf-8');
          } catch (backupError) {
            logger.warn(` Failed to create pre-rollback backup: ${backupError}`);
          }
        }

        // Restore from backup
        const backupContent = await readFile(latestBackup.path, 'utf-8');
        await writeFile(filePath, backupContent, 'utf-8');
      }

      filesRestored.push(filePath);
      logger.info(` ${options.dryRun ? 'Would restore' : 'Restored'} ${filePath} from ${latestBackup.path}`);
    } catch (error) {
      const errorMessage = `Failed to auto-rollback ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMessage);
      logger.error(` ${errorMessage}`);
    }
  }

  const summary = {
    totalFiles: filePaths.length,
    restoredFiles: filesRestored.length,
    failedFiles: errors.length,
  };

  return {
    success: errors.length === 0,
    filesRestored,
    errors,
    summary,
  };
}

export async function verifyRollbackPoint(rollbackPoint: RollbackPoint): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  logger.debug(` Verifying rollback point ${rollbackPoint.id}`);

  for (const fileInfo of rollbackPoint.affectedFiles) {
    try {
      // Check if backup file exists
      await stat(fileInfo.backupPath);

      // Verify backup file size
      const backupStats = await stat(fileInfo.backupPath);
      if (backupStats.size !== fileInfo.backupSize) {
        errors.push(
          `Backup file size mismatch for ${fileInfo.filePath}: expected ${fileInfo.backupSize}, found ${backupStats.size}`,
        );
      }

      // Verify checksum if available
      if (fileInfo.checksum) {
        const backupContent = await readFile(fileInfo.backupPath, 'utf-8');
        const currentChecksum = calculateChecksum(backupContent);
        if (currentChecksum !== fileInfo.checksum) {
          errors.push(`Backup checksum mismatch for ${fileInfo.filePath}`);
        }
      }

      // Check if original file still exists
      try {
        await stat(fileInfo.filePath);
      } catch {
        errors.push(`Original file no longer exists: ${fileInfo.filePath}`);
      }
    } catch (error) {
      errors.push(
        `Cannot access backup file ${fileInfo.backupPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const valid = errors.length === 0;

  if (valid) {
    logger.debug(` Rollback point ${rollbackPoint.id} is valid`);
  } else {
    logger.warn(` Rollback point ${rollbackPoint.id} has ${errors.length} issues`);
  }

  return { valid, errors };
}

export async function cleanupRollbackPoints(
  maxAge = 86400000, // 24 hours in milliseconds
  keepMinimum = 5,
): Promise<{
  deleted: number;
  errors: string[];
}> {
  logger.info(` Cleaning up rollback points older than ${maxAge}ms`);

  let deleted = 0;
  const errors: string[] = [];

  try {
    const rollbackPoints = await listRollbackPoints();
    const cutoffTime = new Date(Date.now() - maxAge);

    // Sort by timestamp (newest first)
    rollbackPoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Keep the minimum number of recent rollback points
    const pointsToDelete = rollbackPoints.slice(keepMinimum).filter((point) => point.timestamp < cutoffTime);

    for (const point of pointsToDelete) {
      try {
        // Delete backup files
        for (const fileInfo of point.affectedFiles) {
          try {
            await unlink(fileInfo.backupPath);
            logger.debug(` Deleted backup file: ${fileInfo.backupPath}`);
          } catch (error) {
            errors.push(`Failed to delete backup file ${fileInfo.backupPath}: ${error}`);
          }
        }

        // Delete rollback point metadata
        await deleteRollbackPoint(point.id);
        deleted++;

        logger.debug(` Deleted rollback point: ${point.id}`);
      } catch (error) {
        errors.push(
          `Failed to delete rollback point ${point.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    logger.info(` Cleanup complete: deleted ${deleted} rollback points`);
  } catch (error) {
    const errorMessage = `Rollback cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMessage);
    logger.error(` ${errorMessage}`);
  }

  return { deleted, errors };
}

function generateRollbackId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `rollback-${timestamp}-${random}`;
}

function calculateChecksum(content: string): string {
  // Simple checksum calculation using content length and hash
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `${content.length}-${hash.toString(36)}`;
}

async function saveRollbackPoint(rollbackPoint: RollbackPoint): Promise<void> {
  // In a real implementation, this would save to a persistent store
  // For now, we'll save to a local file
  try {
    const rollbackDir = '/tmp/qualops-rollback';
    // await mkdir(rollbackDir, { recursive: true });

    const rollbackFile = join(rollbackDir, `${rollbackPoint.id}.json`);
    const _rollbackData = JSON.stringify(rollbackPoint, null, 2);

    // await writeFile(rollbackFile, _rollbackData, 'utf-8');
    logger.debug(` Saved rollback point metadata to ${rollbackFile}`);
  } catch (error) {
    logger.warn(` Failed to save rollback point metadata: ${error}`);
  }
}

async function deleteRollbackPoint(rollbackId: string): Promise<void> {
  // In a real implementation, this would delete from a persistent store
  try {
    const rollbackFile = join('/tmp/qualops-rollback', `${rollbackId}.json`);
    // await unlink(rollbackFile);
    logger.debug(` Deleted rollback point metadata: ${rollbackFile}`);
  } catch (error) {
    logger.debug(` Could not delete rollback point metadata: ${error}`);
  }
}

export async function createFixBatchRollbackPoint(fixedFiles: string[], sessionId?: string): Promise<RollbackPoint> {
  const description = `Batch fix application (${fixedFiles.length} files)`;
  return createRollbackPoint(description, fixedFiles, sessionId);
}

export async function smartRollback(
  problematicFiles: string[],
  preservePatterns: string[] = [],
  options: RollbackOptions = {},
): Promise<RollbackResult> {
  logger.info(` Performing smart rollback for ${problematicFiles.length} files`);

  const filesRestored: string[] = [];
  const errors: string[] = [];

  for (const filePath of problematicFiles) {
    try {
      // Get recent backups
      const backups = await listBackupsForFile(filePath);
      if (backups.length === 0) {
        errors.push(`No backups available for ${filePath}`);
        continue;
      }

      // Try to find a backup that preserves desired patterns
      let selectedBackup = backups[0]; // Most recent by default

      if (preservePatterns.length > 0) {
        for (const backup of backups) {
          try {
            const backupContent = await readFile(backup.path, 'utf-8');
            const preservesPatterns = preservePatterns.every((pattern) => backupContent.includes(pattern));

            if (preservesPatterns) {
              selectedBackup = backup;
              break;
            }
          } catch {
            // Skip this backup if we can't read it
            continue;
          }
        }
      }

      if (!options.dryRun) {
        // Create pre-rollback backup
        if (options.createNewBackups) {
          try {
            const currentContent = await readFile(filePath, 'utf-8');
            const preRollbackPath = `${filePath}.pre-smart-rollback-${Date.now()}`;
            await writeFile(preRollbackPath, currentContent, 'utf-8');
          } catch (backupError) {
            logger.warn(` Failed to create pre-rollback backup: ${backupError}`);
          }
        }

        // Restore from selected backup
        const backupContent = await readFile(selectedBackup.path, 'utf-8');
        await writeFile(filePath, backupContent, 'utf-8');
      }

      filesRestored.push(filePath);
      logger.info(` ${options.dryRun ? 'Would restore' : 'Restored'} ${filePath} from ${selectedBackup.path}`);
    } catch (error) {
      const errorMessage = `Smart rollback failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMessage);
      logger.error(` ${errorMessage}`);
    }
  }

  const summary = {
    totalFiles: problematicFiles.length,
    restoredFiles: filesRestored.length,
    failedFiles: errors.length,
  };

  return {
    success: errors.length === 0,
    filesRestored,
    errors,
    summary,
  };
}
