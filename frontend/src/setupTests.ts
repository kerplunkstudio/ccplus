import '@testing-library/jest-dom';

// Suppress console.error for expected async state updates after unmount in tests
const originalError = console.error;
global.console.error = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('An update to TestComponent inside a test was not wrapped in act') ||
     args[0].includes('The current testing environment is not configured to support act'))
  ) {
    return;
  }
  originalError.call(console, ...args);
};

// Mock clipboard API globally
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: jest.fn(() => Promise.resolve()),
  },
  writable: true,
  configurable: true,
});
