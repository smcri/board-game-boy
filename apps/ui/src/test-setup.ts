import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// Clear localStorage before each test.
beforeEach(() => {
  localStorage.clear();
});
