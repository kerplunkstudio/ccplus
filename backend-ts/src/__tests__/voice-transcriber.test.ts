import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as https from 'https';
import * as fs from 'fs';

// Mock https module
vi.mock('https');

// Mock fs module
vi.mock('fs');

// Mock @xenova/transformers with a function that returns the mock
const mockPipeline = vi.fn();
vi.mock('@xenova/transformers', () => ({
  pipeline: mockPipeline,
}));

describe('voice-transcriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset modules to clear the cached transcriber
    vi.resetModules();
  });

  describe('downloadTelegramFile', () => {
    it('should construct correct getFile URL and download file', async () => {
      const botToken = 'test-bot-token';
      const fileId = 'test-file-id';
      const filePath = 'voice/file_123.ogg';
      const fileContent = Buffer.from('mock audio data');

      // Mock getFile API response
      const getFileResponse = {
        statusCode: 200,
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from(JSON.stringify({ result: { file_path: filePath } })));
          } else if (event === 'end') {
            handler();
          }
          return getFileResponse;
        }),
      };

      // Mock file download response
      const downloadResponse = {
        statusCode: 200,
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(fileContent);
          } else if (event === 'end') {
            handler();
          }
          return downloadResponse;
        }),
      };

      const mockHttpsGet = vi.mocked(https.get);
      mockHttpsGet
        .mockImplementationOnce((url, callback) => {
          expect(url).toBe(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
          callback(getFileResponse as any);
          return { on: vi.fn() } as any;
        })
        .mockImplementationOnce((url, callback) => {
          expect(url).toBe(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
          callback(downloadResponse as any);
          return { on: vi.fn() } as any;
        });

      const { downloadTelegramFile } = await import('../voice-transcriber.js');
      const result = await downloadTelegramFile(botToken, fileId);

      expect(result).toEqual(fileContent);
      expect(mockHttpsGet).toHaveBeenCalledTimes(2);
    });

    it('should throw error on non-200 status for getFile', async () => {
      const botToken = 'test-bot-token';
      const fileId = 'test-file-id';

      const errorResponse = {
        statusCode: 404,
        on: vi.fn((event, handler) => {
          if (event === 'end') {
            handler();
          }
          return errorResponse;
        }),
      };

      const mockHttpsGet = vi.mocked(https.get);
      mockHttpsGet.mockImplementationOnce((url, callback) => {
        callback(errorResponse as any);
        return { on: vi.fn() } as any;
      });

      const { downloadTelegramFile } = await import('../voice-transcriber.js');
      await expect(downloadTelegramFile(botToken, fileId)).rejects.toThrow('HTTP 404');
    });

    it('should throw error on non-200 status for file download', async () => {
      const botToken = 'test-bot-token';
      const fileId = 'test-file-id';
      const filePath = 'voice/file_123.ogg';

      const getFileResponse = {
        statusCode: 200,
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from(JSON.stringify({ result: { file_path: filePath } })));
          } else if (event === 'end') {
            handler();
          }
          return getFileResponse;
        }),
      };

      const downloadErrorResponse = {
        statusCode: 500,
        on: vi.fn((event, handler) => {
          if (event === 'end') {
            handler();
          }
          return downloadErrorResponse;
        }),
      };

      const mockHttpsGet = vi.mocked(https.get);
      mockHttpsGet
        .mockImplementationOnce((url, callback) => {
          callback(getFileResponse as any);
          return { on: vi.fn() } as any;
        })
        .mockImplementationOnce((url, callback) => {
          callback(downloadErrorResponse as any);
          return { on: vi.fn() } as any;
        });

      const { downloadTelegramFile } = await import('../voice-transcriber.js');
      await expect(downloadTelegramFile(botToken, fileId)).rejects.toThrow('HTTP 500');
    });
  });

  describe('transcribeAudio', () => {
    it('should transcribe audio and return text', async () => {
      const audioBuffer = Buffer.from('mock audio data');
      const transcriptionText = 'Hello, this is a test transcription';

      const mockTranscriber = vi.fn().mockResolvedValue({ text: transcriptionText });
      mockPipeline.mockResolvedValue(mockTranscriber as any);

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe(transcriptionText);
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
      expect(mockTranscriber).toHaveBeenCalledOnce();
    });

    it('should return empty string when transcription result is empty', async () => {
      const audioBuffer = Buffer.from('mock audio data');

      const mockTranscriber = vi.fn().mockResolvedValue({ text: '' });
      mockPipeline.mockResolvedValue(mockTranscriber as any);

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe('');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
    });

    it('should return empty string and log error on transcription failure', async () => {
      const audioBuffer = Buffer.from('mock audio data');

      const mockTranscriber = vi.fn().mockRejectedValue(new Error('Whisper model failed'));
      mockPipeline.mockResolvedValue(mockTranscriber as any);

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe('');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      // File cleanup should still happen
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
    });

    it('should clean up temp file even if unlink fails', async () => {
      const audioBuffer = Buffer.from('mock audio data');
      const transcriptionText = 'Test transcription';

      const mockTranscriber = vi.fn().mockResolvedValue({ text: transcriptionText });
      mockPipeline.mockResolvedValue(mockTranscriber as any);

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('File deletion failed');
      });

      // Should not throw despite cleanup error
      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe(transcriptionText);
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
    });

    it('should handle result without text property', async () => {
      const audioBuffer = Buffer.from('mock audio data');

      const mockTranscriber = vi.fn().mockResolvedValue({});
      mockPipeline.mockResolvedValue(mockTranscriber as any);

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe('');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
    });
  });
});
