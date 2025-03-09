/**
 * Simple logger implementation
 */
const logger = {
  info: (message: string, context?: any) => {
    if (context) {
      console.error(`[INFO] ${message}`, context);
    } else {
      console.error(`[INFO] ${message}`);
    }
  },
  
  warn: (message: string, context?: any) => {
    if (context) {
      console.error(`[WARN] ${message}`, context);
    } else {
      console.error(`[WARN] ${message}`);
    }
  },
  
  error: (message: string, context?: any) => {
    if (context) {
      console.error(`[ERROR] ${message}`, context);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },
  
  debug: (message: string, context?: any) => {
    if (process.env.DEBUG) {
      if (context) {
        console.error(`[DEBUG] ${message}`, context);
      } else {
        console.error(`[DEBUG] ${message}`);
      }
    }
  }
};

export default logger; 
