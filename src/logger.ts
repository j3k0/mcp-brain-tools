/**
 * Simple logger implementation
 */
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = 'dolphin-mcp.log';

// Format timestamp for log entries
const getTimestamp = () => {
  return new Date().toISOString();
};

// Write message to log file
const writeToFile = (message: string) => {
  try {
    fs.appendFileSync(LOG_FILE, `${getTimestamp()} ${message}\n`);
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
};

const logger = {
  info: (message: string, context?: any) => {
    const logMessage = `[INFO] ${message}`;
    if (context) {
      console.error(logMessage, context);
      writeToFile(`${logMessage} ${JSON.stringify(context)}`);
    } else {
      console.error(logMessage);
      writeToFile(logMessage);
    }
  },
  
  warn: (message: string, context?: any) => {
    const logMessage = `[WARN] ${message}`;
    if (context) {
      console.error(logMessage, context);
      writeToFile(`${logMessage} ${JSON.stringify(context)}`);
    } else {
      console.error(logMessage);
      writeToFile(logMessage);
    }
  },
  
  error: (message: string, context?: any) => {
    const logMessage = `[ERROR] ${message}`;
    if (context) {
      console.error(logMessage, context);
      writeToFile(`${logMessage} ${JSON.stringify(context)}`);
    } else {
      console.error(logMessage);
      writeToFile(logMessage);
    }
  },
  
  debug: (message: string, context?: any) => {
    if (process.env.DEBUG) {
      const logMessage = `[DEBUG] ${message}`;
      if (context) {
        console.error(logMessage, context);
        writeToFile(`${logMessage} ${JSON.stringify(context)}`);
      } else {
        console.error(logMessage);
        writeToFile(logMessage);
      }
    }
  }
};

export default logger; 
