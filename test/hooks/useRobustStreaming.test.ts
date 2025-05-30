import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRobustStreaming } from '../../src/hooks/useRobustStreaming';

// Mock the stream-recovery module
vi.mock('../../src/utils/stream-recovery', () => {
  const mockRecoveryManager = {
    classifyError: vi.fn((error) => ({
      type: 'network',
      message: error.message || 'Network error',
      retryable: true,
      timestamp: Date.now(),
    })),
    shouldRetry: vi.fn(() => true),
    prepareRetry: vi.fn(),
    updatePartialContent: vi.fn(),
    getRecoveryHeaders: vi.fn(() => ({})),
    createAbortController: vi.fn(() => new AbortController()),
    abort: vi.fn(),
    reset: vi.fn(),
    getState: vi.fn(() => ({ attempts: 0, isRecovering: false })),
  };

  return {
    StreamRecoveryManager: vi.fn(() => mockRecoveryManager),
    StreamErrorType: {
      NETWORK: 'network',
      RATE_LIMIT: 'rate_limit',
      AUTH: 'auth',
      SERVER: 'server',
      TOKEN_LIMIT: 'token_limit',
      TIMEOUT: 'timeout',
      ABORTED: 'aborted',
      UNKNOWN: 'unknown',
    },
  };
});

describe('useRobustStreaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useRobustStreaming());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBe('');
    expect(result.current.error).toBeUndefined();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('should handle successful streaming response', async () => {
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            })
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":" World"}}]}\n\n'),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const onData = vi.fn();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useRobustStreaming({ onData, onComplete }));

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.data).toBe('Hello World');
      expect(onData).toHaveBeenCalledWith('Hello');
      expect(onData).toHaveBeenCalledWith(' World');
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('should handle streaming with reasoning content', async () => {
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}\n\n'),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRobustStreaming());

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.data).toBe('Thinking...');
    });
  });

  it('should handle [DONE] signal', async () => {
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Test"}}]}\ndata: [DONE]\n\n'),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRobustStreaming());

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.data).toBe('Test');
    });
  });

  it('should handle network errors with retry', async () => {
    const networkError = new Error('Network error');
    global.fetch = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Success"}}]}\n\n'),
              })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      });

    const onError = vi.fn();
    const { result } = renderHook(() => useRobustStreaming({ onError }));

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.data).toBe('Success');
    });
  });

  it('should handle non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const onError = vi.fn();
    const { result } = renderHook(() => useRobustStreaming({ onError }));

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
      expect(onError).toHaveBeenCalled();
    });
  });

  it('should handle stop functionality', async () => {
    const mockReader = {
      read: vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ done: true }), 1000))
      ),
      cancel: vi.fn(),
    };

    const mockResponse = {
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRobustStreaming());

    act(() => {
      result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected');
    });

    act(() => {
      result.current.stop();
    });

    expect(mockReader.cancel).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('should handle reset functionality', () => {
    const { result } = renderHook(() => useRobustStreaming());

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBe('');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('should handle timeout errors', async () => {
    const timeoutError = new Error('Request timeout');
    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    const { StreamRecoveryManager } = await import('../../src/utils/stream-recovery');
    const mockManager = StreamRecoveryManager as any;
    mockManager.mockImplementation(() => ({
      classifyError: vi.fn(() => ({
        type: 'timeout',
        message: 'Request timeout',
        retryable: true,
        timestamp: Date.now(),
      })),
      shouldRetry: vi.fn().mockResolvedValueOnce(false),
      getRecoveryHeaders: vi.fn(() => ({})),
      createAbortController: vi.fn(() => new AbortController()),
    }));

    const onError = vi.fn();
    const { result } = renderHook(() => useRobustStreaming({ onError }));

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe('Request timeout');
      expect(onError).toHaveBeenCalled();
    });
  });

  it('should parse SSE with multiple fields', async () => {
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(
                'id: event-123\ndata: {"choices":[{"delta":{"content":"Test"}}]}\n\n'
              ),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRobustStreaming());

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(result.current.data).toBe('Test');
    });
  });

  it('should handle malformed JSON in SSE', async () => {
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {invalid json}\n\n'),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useRobustStreaming());

    await act(async () => {
      await result.current.start('https://api.test.com', {});
    });

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to parse SSE data:', expect.any(Error));
    });

    consoleSpy.mockRestore();
  });
});