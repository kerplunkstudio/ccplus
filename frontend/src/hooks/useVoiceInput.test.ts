import { renderHook, act } from '@testing-library/react';
import { useVoiceInput } from './useVoiceInput';

// Mock SpeechRecognition
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 0;
  onstart: ((this: any, ev: Event) => void) | null = null;
  onend: ((this: any, ev: Event) => void) | null = null;
  onresult: ((this: any, ev: any) => void) | null = null;
  onerror: ((this: any, ev: any) => void) | null = null;

  start() {
    if (this.onstart) {
      this.onstart.call(this, new Event('start'));
    }
  }

  stop() {
    if (this.onend) {
      this.onend.call(this, new Event('end'));
    }
  }

  abort() {
    if (this.onend) {
      this.onend.call(this, new Event('end'));
    }
  }

  // Test helper to trigger result event
  triggerResult(transcript: string, isFinal: boolean) {
    if (this.onresult) {
      const event = {
        results: [
          {
            0: { transcript, confidence: 0.9 },
            isFinal,
            length: 1,
            item: (index: number) => ({ transcript, confidence: 0.9 })
          }
        ],
        resultIndex: 0
      };
      this.onresult.call(this, event);
    }
  }

  // Test helper to trigger error event
  triggerError(error: string, message: string) {
    if (this.onerror) {
      const event = { error, message };
      this.onerror.call(this, event);
    }
  }
}

describe('useVoiceInput', () => {
  let mockRecognition: MockSpeechRecognition;

  beforeEach(() => {
    mockRecognition = new MockSpeechRecognition();
    (window as any).SpeechRecognition = jest.fn(() => mockRecognition);
  });

  afterEach(() => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });

  it('returns isSupported true when Web Speech API is available', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(true);
  });

  it('returns isSupported false when Web Speech API is not available', () => {
    delete (window as any).SpeechRecognition;
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(false);
  });

  it('checks webkitSpeechRecognition as fallback', () => {
    delete (window as any).SpeechRecognition;
    (window as any).webkitSpeechRecognition = jest.fn(() => mockRecognition);
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(true);
  });

  it('initializes with correct default state', () => {
    const { result } = renderHook(() => useVoiceInput());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBe(null);
  });

  it('configures recognition with correct settings', () => {
    renderHook(() => useVoiceInput());

    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.interimResults).toBe(true);
    expect(mockRecognition.lang).toBe('en-US');
    expect(mockRecognition.maxAlternatives).toBe(1);
  });

  it('starts recording when startRecording is called', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it('stops recording when stopRecording is called', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('updates transcript with interim results', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerResult('hello', false);
    });

    expect(result.current.transcript).toBe('hello');
  });

  it('updates transcript with final results', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerResult('hello world', true);
    });

    expect(result.current.transcript).toBe('hello world');
  });

  it('prefers final results over interim results', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    // First interim
    act(() => {
      mockRecognition.triggerResult('hello', false);
    });

    expect(result.current.transcript).toBe('hello');

    // Then final
    act(() => {
      mockRecognition.triggerResult('hello world', true);
    });

    expect(result.current.transcript).toBe('hello world');
  });

  it('clears transcript when starting new recording', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerResult('first recording', true);
    });

    expect(result.current.transcript).toBe('first recording');

    act(() => {
      result.current.stopRecording();
    });

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.transcript).toBe('');
  });

  it('handles not-allowed error with user-friendly message', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('not-allowed', 'Permission denied');
    });

    expect(result.current.error).toBe('Microphone access denied. Please enable microphone permissions.');
    expect(result.current.isRecording).toBe(false);
  });

  it('handles no-speech error', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('no-speech', 'No speech detected');
    });

    expect(result.current.error).toBe('No speech detected. Try again.');
    expect(result.current.isRecording).toBe(false);
  });

  it('handles audio-capture error', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('audio-capture', 'Microphone not available');
    });

    expect(result.current.error).toBe('Microphone not available. Check your audio settings.');
    expect(result.current.isRecording).toBe(false);
  });

  it('handles network error', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('network', 'Network error');
    });

    expect(result.current.error).toBe('Network error. Voice recognition requires internet connection.');
    expect(result.current.isRecording).toBe(false);
  });

  it('handles aborted error without setting error message', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('aborted', 'User cancelled');
    });

    expect(result.current.error).toBe(null);
    expect(result.current.isRecording).toBe(false);
  });

  it('handles generic error with error code', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('unknown-error', 'Something went wrong');
    });

    expect(result.current.error).toBe('Voice recognition error: unknown-error');
    expect(result.current.isRecording).toBe(false);
  });

  it('does not start recording if already recording', () => {
    const { result } = renderHook(() => useVoiceInput());
    const startSpy = jest.spyOn(mockRecognition, 'start');

    act(() => {
      result.current.startRecording();
    });

    expect(startSpy).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.startRecording();
    });

    // Should not call start again
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('does not stop recording if not recording', () => {
    const { result } = renderHook(() => useVoiceInput());
    const stopSpy = jest.spyOn(mockRecognition, 'stop');

    act(() => {
      result.current.stopRecording();
    });

    // Should not call stop
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('cleans up recognition on unmount', () => {
    const { unmount } = renderHook(() => useVoiceInput());
    const abortSpy = jest.spyOn(mockRecognition, 'abort');

    unmount();

    expect(abortSpy).toHaveBeenCalled();
  });

  it('does not throw when API is not supported', () => {
    delete (window as any).SpeechRecognition;
    const { result } = renderHook(() => useVoiceInput());

    expect(() => {
      act(() => {
        result.current.startRecording();
      });
    }).not.toThrow();

    expect(result.current.isRecording).toBe(false);
  });

  it('clears error when starting new recording', () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockRecognition.triggerError('no-speech', 'No speech');
    });

    expect(result.current.error).toBe('No speech detected. Try again.');

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.error).toBe(null);
  });
});
