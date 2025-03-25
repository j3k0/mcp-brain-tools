import { promises as fs } from 'fs';
import path from 'path';
import GroqAI from '../ai-service.js';
import logger from '../logger.js';
import type { PathLike } from 'fs';
import type { dirname } from 'path';

/**
 * Smart file inspection that uses AI to filter relevant content
 * @param filePath Path to the file to inspect
 * @param informationNeeded Description of what information is needed from the file
 * @param reason Additional context about why this information is needed
 * @returns Array of relevant lines with their line numbers and relevance scores
 */
export async function inspectFile(
  filePath: PathLike,
  informationNeeded: string,
  reason?: string
): Promise<{lines: {lineNumber: number, content: string}[], tentativeAnswer?: string}> {
  try {
    // Read the file
    const content = await fs.readFile(filePath, 'utf8');
    
    // Split into lines and add line numbers
    const lines = content.split('\n').map((content, index) => ({
      lineNumber: index + 1, // Convert to 1-based line numbers
      content: content.trimEnd() // Remove trailing whitespace but preserve indentation
    }));

    // If AI service is not enabled, return all lines with default relevance
    if (!GroqAI.isEnabled) {
      logger.warn('AI service not enabled, returning all lines');
      return {lines};
    }

    // Use AI to filter relevant content
    const agentResponse = await GroqAI.filterFileContent(lines, informationNeeded, reason);
    const ranges = agentResponse.lineRanges;
    function isInRange(lineNumber: number, range: string): boolean {
      const [start, end] = range.split('-').map(Number);
      return lineNumber >= start && lineNumber <= end;
    }

    return {
      lines: lines.filter(line => ranges.some(range => isInRange(line.lineNumber, range))),
      tentativeAnswer: agentResponse.tentativeAnswer
    };
  } catch (error) {
    logger.error('Error inspecting file:', { error, filePath });
    throw error;
  }
}

/**
 * Read a file's contents
 * @param filePath Path to the file to read
 * @returns The file contents as a string
 */
export async function readFile(filePath: PathLike): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    logger.error('Error reading file:', { error, filePath });
    throw error;
  }
}

/**
 * Write content to a file
 * @param filePath Path to the file to write
 * @param content Content to write
 */
export async function writeFile(filePath: PathLike, content: string): Promise<void> {
  try {
    // Ensure the directory exists
    await fs.mkdir(path.dirname(filePath.toString()), { recursive: true });
    await fs.writeFile(filePath, content);
  } catch (error) {
    logger.error('Error writing file:', { error, filePath });
    throw error;
  }
}

/**
 * Delete a file
 * @param filePath Path to the file to delete
 */
export async function deleteFile(filePath: PathLike): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    logger.error('Error deleting file:', { error, filePath });
    throw error;
  }
}

/**
 * List files in a directory
 * @param dirPath Path to the directory to list
 * @returns Array of file names in the directory
 */
export async function listFiles(dirPath: PathLike): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch (error) {
    logger.error('Error listing directory:', { error, dirPath });
    throw error;
  }
}

/**
 * Check if a file exists
 * @param filePath Path to check
 * @returns True if the file exists, false otherwise
 */
export async function fileExists(filePath: PathLike): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
} 