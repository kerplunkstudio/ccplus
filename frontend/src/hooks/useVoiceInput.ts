import { useState, useCallback, useRef, useEffect } from 'react';

// TypeScript declarations for Web Speech API (not in standard lib)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface UseVoiceInputReturn {
  isRecording: boolean;
  isSupported: boolean;
  transcript: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Check if Web Speech API is supported
  const isSupported = Boolean(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  // Initialize recognition instance
  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsRecording(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcriptPiece = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcriptPiece + ' ';
        } else {
          interimTranscript += transcriptPiece;
        }
      }

      // Update transcript (prefer final, fallback to interim)
      if (finalTranscript) {
        setTranscript(finalTranscript.trim());
      } else if (interimTranscript) {
        setTranscript(interimTranscript.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsRecording(false);

      // Map error codes to user-friendly messages
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          setError('Microphone access denied. Please enable microphone permissions.');
          break;
        case 'no-speech':
          setError('No speech detected. Try again.');
          break;
        case 'audio-capture':
          setError('Microphone not available. Check your audio settings.');
          break;
        case 'network':
          setError('Network error. Voice recognition requires internet connection.');
          break;
        case 'aborted':
          // User cancelled, not an error
          setError(null);
          break;
        default:
          setError(`Voice recognition error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [isSupported]);

  const startRecording = useCallback(() => {
    if (!recognitionRef.current || isRecording) return;

    try {
      setTranscript('');
      setError(null);
      recognitionRef.current.start();
    } catch (err) {
      setError('Failed to start voice recognition.');
      setIsRecording(false);
    }
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    if (!recognitionRef.current || !isRecording) return;

    try {
      recognitionRef.current.stop();
    } catch (err) {
      setError('Failed to stop voice recognition.');
      setIsRecording(false);
    }
  }, [isRecording]);

  return {
    isRecording,
    isSupported,
    transcript,
    error,
    startRecording,
    stopRecording,
  };
}
