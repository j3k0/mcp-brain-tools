import { promises as fs } from 'fs';
import path from 'path';
import GroqAI from '../ai-service.js';
import logger from '../logger.js';
import type { PathLike } from 'fs';
import type { dirname } from 'path';

/**
 * Escapes special characters in a string for use in a regular expression
 * @param string The string to escape
 * @returns Escaped string safe for regex usage
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Default ignore patterns for file discovery
 */
const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.next/**',
  '**/out/**',
  '**/logs/**',
  '**/*.log',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.d.ts'
];

const MAX_LINES = 1000;

/**
 * Check if a path matches any of the ignore patterns
 * @param filePath Path to check
 * @param ignorePatterns Array of glob patterns to ignore
 * @returns True if the path should be ignored
 */
function shouldIgnore(filePath: string, ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS): boolean {
  // Simple glob pattern matching
  for (const pattern of ignorePatterns) {
    if (pattern.startsWith('**/')) {
      // Pattern like "**/node_modules/**"
      const part = pattern.slice(3);
      if (filePath.includes(part)) {
        return true;
      }
    } else if (pattern.endsWith('/**')) {
      // Pattern like ".git/**"
      const part = pattern.slice(0, -3);
      if (filePath.startsWith(part + '/') || filePath === part) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Pattern like "*.log"
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(path.basename(filePath))) {
        return true;
      }
    } else {
      // Exact match
      if (filePath.endsWith(pattern) || filePath === pattern) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recursively discover files in a directory
 * @param dirPath Path to the directory to scan
 * @param ignorePatterns Array of glob patterns to ignore
 * @param baseDir Base directory for relative path calculation (usually the same as dirPath initially)
 * @returns Array of file paths discovered
 */
export async function discoverFiles(
  dirPath: string,
  ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS,
  baseDir?: string
): Promise<string[]> {
  // Initialize baseDir on first call
  baseDir = baseDir || dirPath;
  
  // Get directory contents
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  
  // Process each entry
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    // Skip ignored paths
    if (shouldIgnore(relativePath, ignorePatterns)) {
      continue;
    }
    
    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const subDirFiles = await discoverFiles(fullPath, ignorePatterns, baseDir);
      files.push(...subDirFiles);
    } else if (entry.isFile()) {
      // Add files to the result
      files.push(fullPath);
    }
  }
  
  return files;
}

async function listTopLevelDirectories(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory()).map(entry => path.join(dirPath, entry.name));
}

/**
 * Search for files containing specific keywords in a directory
 * @param dirPath Path to the directory to search
 * @param keywords Array of keywords to search for
 * @param ignorePatterns Array of glob patterns to ignore
 * @param maxResults Maximum number of results to return
 * @returns Array of file paths that match the keywords
 */
export async function searchFilesByKeywords(
  dirPath: string,
  keywords: string[],
  ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS,
  maxResults: number = 20
): Promise<string[]> {
  // No keywords - just return all files up to maxResults
  if (!keywords || keywords.length === 0) {
    const allFiles = await discoverFiles(dirPath, ignorePatterns);
    return allFiles.slice(0, maxResults);
  }

  logger.info(`Searching for files with keywords: ${keywords.join(', ')}`);
  
  // Create a regex pattern from keywords
  const keywordPattern = new RegExp(keywords.map(k => escapeRegExp(k)).join('|'), 'i');
  
  // Get all files recursively
  const allFiles = await discoverFiles(dirPath, ignorePatterns);
  const matchingFiles: string[] = [];
  
  // First pass: Check file names only (faster)
  for (const file of allFiles) {
    if (keywordPattern.test(file)) {
      matchingFiles.push(file);
      if (matchingFiles.length >= maxResults) {
        logger.info(`Found ${matchingFiles.length} files matching keywords in file names`);
        return matchingFiles;
      }
    }
  }
  
  // Second pass: Check file contents for remaining files
  for (const file of allFiles) {
    // Skip files already matched
    if (matchingFiles.includes(file)) {
      continue;
    }
    
    try {
      const content = await fs.readFile(file, 'utf8');
      if (keywordPattern.test(content)) {
        matchingFiles.push(file);
        if (matchingFiles.length >= maxResults) {
          logger.info(`Found ${matchingFiles.length} files matching keywords`);
          return matchingFiles;
        }
      }
    } catch (error) {
      // Skip files that can't be read
      logger.warn(`Could not read file for keyword matching: ${file}`, { error });
    }
  }
  
  logger.info(`Found ${matchingFiles.length} files matching keywords`);
  return matchingFiles;
}

/**
 * Smart file inspection that uses AI to filter relevant content
 * @param filePath Path to the file or directory to inspect
 * @param informationNeeded Description of what information is needed from the file
 * @param reason Additional context about why this information is needed
 * @param keywords Optional array of keywords to filter files when inspecting directories
 * @returns Array of relevant lines with their line numbers and relevance scores
 */
export async function inspectFile(
  filePath: PathLike,
  informationNeeded: string,
  reason?: string,
  keywords?: string[]
): Promise<{lines: {lineNumber: number, content: string}[], tentativeAnswer?: string}> {
  try {
    // Check if this is a directory
    const stats = await fs.stat(filePath);
    
    if (stats.isDirectory()) {
      logger.info(`Inspecting directory: ${filePath}`);
      
      let files: string[] = [];
      
      // If keywords are provided, use them to filter files
      if (keywords && keywords.length > 0) {
        // Use the dedicated keyword search function
        files = await searchFilesByKeywords(filePath.toString(), keywords);
      } else {
        // Discover files in the directory (original behavior)
        files = await discoverFiles(filePath.toString());
      }
      
      if (files.length === 0) {
        return {
          lines: [],
          tentativeAnswer: "No files found in directory after applying filters"
        };
      }
      if (files.length > 80) {
        return {
          lines: (await listTopLevelDirectories(filePath.toString())).map(dir => ({
            lineNumber: 0,
            content: dir
          })),
          tentativeAnswer: "Too many files found in directory, returning list of top level directories"
        };
      }
      
      // Convert to relative paths to save tokens
      const basePath = filePath.toString();
      const relativeFiles = files.map(file => path.relative(basePath, file));
      
      // Prepare a list of files for AI to decide which ones to inspect
      const fileListContent = relativeFiles.map((file, index) => ({
        lineNumber: index + 1,
        content: file
      }));
      
      // If AI service is not enabled, return a limited set of files
      if (!GroqAI.isEnabled) {
        logger.warn('AI service not enabled, returning limited set of files');
        return {
          lines: fileListContent.slice(0, 5),
          tentativeAnswer: "AI service not enabled. Returning first 5 files only."
        };
      }
      
      // Use AI to filter relevant files
      const aiResponse = await GroqAI.filterFileContent(
        fileListContent,
        `Select only the lines with the most relevant file paths (max 5 files) that might contain information about: ${informationNeeded}\nYou can mention additional eventual candidates (file paths) in your tentative answer, but don't include them in the line ranges.`,
        reason
      );
      
      const selectedFileIndices = aiResponse.lineRanges.flatMap(range => {
        const [start, end] = range.split('-').map(Number);
        return Array.from({ length: end - start + 1 }, (_, i) => start + i - 1);
      });
      
      // Get selected files based on line indices (limited to 5)
      const selectedRelativeFiles = selectedFileIndices
        .map(index => {
          if (index >= 0 && index < fileListContent.length) {
            return fileListContent[index].content;
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 5) as string[];
      
      // Convert back to full paths for file reading
      const selectedFiles = selectedRelativeFiles.map(relPath => path.join(basePath, relPath));
      
      // If no files were selected or AI service failed, return a small subset of all files
      if (selectedFiles.length === 0) {
        const maxFiles = 5; // Strictly limit to prevent overloading
        return {
          lines: fileListContent.slice(0, maxFiles),
          tentativeAnswer: "Could not determine relevant files, returning the first few files found"
        };
      }
      
      // Now inspect the selected files individually and combine results
      const allResults: {
        lines: {lineNumber: number, content: string}[],
        tentativeAnswer?: string
      } = { lines: [] };
      
      for (const selectedFile of selectedFiles) {
        try {
          const fileResult = await inspectFile(selectedFile, informationNeeded, reason, keywords);
          
          // Use relative path for context to save tokens
          const relativePath = path.relative(basePath, selectedFile);
          
          // Add file path to each line for context
          const linesWithFilePath = fileResult.lines.map(line => ({
            lineNumber: line.lineNumber,
            content: `[${relativePath}:${line.lineNumber}] ${line.content}`
          }));
          
          allResults.lines.push(...linesWithFilePath);
          
          // Combine tentative answers if available
          if (fileResult.tentativeAnswer && fileResult.tentativeAnswer !== "No answers given by AI") {
            if (!allResults.tentativeAnswer) {
              allResults.tentativeAnswer = `From ${path.basename(selectedFile)}: ${fileResult.tentativeAnswer}`;
            } else {
              allResults.tentativeAnswer += `\n\nFrom ${path.basename(selectedFile)}: ${fileResult.tentativeAnswer}`;
            }
          }
        } catch (error) {
          logger.error('Error inspecting selected file:', { error, selectedFile });
          // Continue with other files even if one fails
        }
      }
      if (allResults.lines.length > MAX_LINES) {
        allResults.lines = allResults.lines.slice(0, MAX_LINES);
      }
      return allResults;
    }
    
    // Original behavior for single file inspection
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
    // throw error;
    return {
      lines: [],
      tentativeAnswer: "Error inspecting file: " + error.message
    };
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