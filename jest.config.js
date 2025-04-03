/**
 * Jest configuration
 */

module.exports = {
  // Indicates which files should be tested
  testMatch: ['**/tests/**/*.test.js'],
  
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  
  // Indicates whether the coverage information should be collected
  collectCoverage: false,
  
  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',
  
  // Indicates which files should be excluded from coverage collection
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  
  // Indicates the environment that will be used for testing
  testEnvironment: 'node',
  
  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: [
    'text',
    'lcov'
  ],
  
  // Makes tests run sequentially
  maxWorkers: 1,
  
  // Silence console output during tests to reduce noise
  silent: true
};