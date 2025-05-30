import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Raycast API
vi.mock('@raycast/api', () => ({
  showToast: vi.fn(),
  Toast: {
    Style: {
      Success: 'success',
      Failure: 'failure',
      Animated: 'animated',
    },
  },
  getPreferenceValues: vi.fn(() => ({
    apiKey: 'test-api-key',
    useStream: true,
    isHistoryPaused: false,
    isAutoSaveConversation: true,
  })),
  clearSearchBar: vi.fn(),
  ActionPanel: vi.fn(),
  List: vi.fn(),
  Icon: vi.fn(),
  Detail: vi.fn(),
  Form: vi.fn(),
  useNavigation: vi.fn(() => ({
    push: vi.fn(),
    pop: vi.fn(),
  })),
  Cache: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  })),
}));

// Mock say module
vi.mock('say', () => ({
  default: {
    stop: vi.fn(),
    speak: vi.fn(),
  },
}));

// Setup global fetch mock
global.fetch = vi.fn();

// Setup global AbortController
global.AbortController = class AbortController {
  signal = {
    aborted: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  abort = vi.fn(() => {
    this.signal.aborted = true;
  });
};