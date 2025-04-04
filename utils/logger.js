/**
 * Standardized logging utility
 */

// ANSI color codes for better terminal visibility
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Map log levels to colors and symbols
const levelConfig = {
  INFO: { color: colors.green, symbol: 'ℹ️ ' },
  ERROR: { color: colors.red, symbol: '❌ ' },
  WARN: { color: colors.yellow, symbol: '⚠️ ' },
  DEBUG: { color: colors.cyan, symbol: '🔍 ' },
  RUNWAY: { color: colors.magenta, symbol: '🎬 ' },
  N8N: { color: colors.blue, symbol: '🔄 ' }
};

/**
 * Creates a consistent log prefix
 * @param {string} area - Logging area/operation name
 * @param {string} [id] - Optional identifier
 * @returns {string} Formatted log prefix
 */
function createLogPrefix(area, id) {
  return id ? `${area}:${id}` : area;
}

/**
 * Logs a message with standard formatting
 * @param {string} level - Log level (e.g., INFO, ERROR)
 * @param {string} area - Logging area/operation name
 * @param {string} message - Log message
 * @param {object} [data] - Optional data to include
 * @param {string} [id] - Optional identifier
 */
function log(level, area, message, data, id) {
  const config = levelConfig[level] || { color: '', symbol: '' };
  const prefix = createLogPrefix(area, id);
  const timestamp = new Date().toISOString();
  
  // Create a more readable timestamp format
  const timeFormatted = timestamp.replace('T', ' ').split('.')[0];
  
  // Format header line
  console.log(`${config.color}${config.symbol}${level}${colors.reset} [${colors.bright}${prefix}${colors.reset}] ${colors.dim}${timeFormatted}${colors.reset}`);
  console.log(`  ${message}`);
  
  // Format data if present
  if (data) {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    console.log(`  ${colors.dim}${dataStr}${colors.reset}\n`);
  } else {
    console.log(''); // Add empty line for better separation
  }
}

/**
 * Specialized logging for Runway API interactions
 * @param {string} action - The action being performed
 * @param {string} message - Log message
 * @param {object} [data] - Optional data to include
 * @param {string} [taskId] - Optional task identifier
 */
function runway(action, message, data, taskId) {
  log('RUNWAY', action, message, data, taskId);
}

/**
 * Specialized logging for n8n API interactions
 * @param {string} action - The action being performed
 * @param {string} message - Log message
 * @param {object} [data] - Optional data to include
 * @param {string} [sessionId] - Optional session identifier
 */
function n8n(action, message, data, sessionId) {
  log('N8N', action, message, data, sessionId);
}

module.exports = {
  info: (area, message, data, id) => log('INFO', area, message, data, id),
  error: (area, message, data, id) => log('ERROR', area, message, data, id),
  warn: (area, message, data, id) => log('WARN', area, message, data, id),
  debug: (area, message, data, id) => log('DEBUG', area, message, data, id),
  runway,
  n8n,
  createLogPrefix
};