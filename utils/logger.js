/**
 * Standardized logging utility
 */

/**
 * Creates a consistent log prefix
 * @param {string} area - Logging area/operation name
 * @param {string} [id] - Optional identifier
 * @returns {string} Formatted log prefix
 */
function createLogPrefix(area, id) {
  return id ? `[${area}][${id}]` : `[${area}]`;
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
  const prefix = createLogPrefix(area, id);
  const timestamp = new Date().toISOString();
  
  console.log(`\n----- ${level}: ${prefix} ${timestamp} -----`);
  console.log(message);
  
  if (data) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

module.exports = {
  info: (area, message, data, id) => log('INFO', area, message, data, id),
  error: (area, message, data, id) => log('ERROR', area, message, data, id),
  warn: (area, message, data, id) => log('WARN', area, message, data, id),
  debug: (area, message, data, id) => log('DEBUG', area, message, data, id),
  createLogPrefix
};