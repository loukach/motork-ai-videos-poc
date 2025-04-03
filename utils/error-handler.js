/**
 * Centralized error handler for API errors
 */

function handleApiError(error, res, operation) {
  console.error(`\n----- API ERROR: ${operation} -----`);
  console.error(`Status: ${error.response?.status || 'Unknown'}`);
  console.error(`Message: ${error.message}`);
  if (error.response?.data) {
    console.error('Response data:', JSON.stringify(error.response.data, null, 2));
  }
  return res.status(error.response?.status || 500).json(
    error.response?.data || { error: 'Internal server error' }
  );
}

module.exports = { handleApiError };