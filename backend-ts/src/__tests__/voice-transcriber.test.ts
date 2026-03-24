import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as https from 'https';
import * as fs from 'fs';

// Mock https module
vi.mock('https');

// Mock fs module
vi.mock('fs');

// Mock child_process module
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

// Mock util module to return a promisified version of execFile
vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: (fn: any) => {
      if (fn === mockExecFile) {
        return mockExecFile;
      }
      return (actual as any).promisify(fn);
    },
  };
});

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
    it('should convert OGG to WAV and transcribe audio', async () => {
      const audioBuffer = Buffer.from('mock audio data');
      const transcriptionText = 'Hello, this is a test transcription';

      // Mock execFile for binary checks + ffmpeg + whisper-cli
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg --version check
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg conversion
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // whisper-cli --version check
        .mockResolvedValueOnce({ stdout: transcriptionText + '\n', stderr: '' });  // whisper-cli

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe(transcriptionText);
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);  // Clean up both OGG and WAV
      expect(mockExecFile).toHaveBeenCalledTimes(4);  // ffmpeg --version + ffmpeg + whisper-cli --version + whisper-cli

      // Verify ffmpeg was called with correct args (now at index 1, not 0)
      const ffmpegCall = mockExecFile.mock.calls[1];
      expect(ffmpegCall[0]).toBe(process.env.FFMPEG_PATH || 'ffmpeg');
      expect(ffmpegCall[1]).toContain('-y');
      expect(ffmpegCall[1]).toContain('-ar');
      expect(ffmpegCall[1]).toContain('16000');
      expect(ffmpegCall[1]).toContain('-ac');
      expect(ffmpegCall[1]).toContain('1');
      expect(ffmpegCall[1]).toContain('-c:a');
      expect(ffmpegCall[1]).toContain('pcm_s16le');

      // Verify whisper-cli was called (now at index 3, not 1)
      const whisperCall = mockExecFile.mock.calls[3];
      expect(whisperCall[0]).toBe(process.env.WHISPER_CLI_PATH || 'whisper-cli');
      expect(whisperCall[1]).toContain('--no-timestamps');
      expect(whisperCall[1]).not.toContain('--output-txt');  // Should not have this flag
    });

    it('should return empty string when transcription result is empty', async () => {
      const audioBuffer = Buffer.from('mock audio data');

      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg --version check
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // whisper-cli --version check
        .mockResolvedValueOnce({ stdout: '', stderr: '' });  // whisper-cli

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe('');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should throw error on ffmpeg binary missing', async () => {
      const audioBuffer = Buffer.from('mock audio data');

      // ffmpeg --version check fails (binary not found)
      mockExecFile.mockRejectedValueOnce(new Error('Command failed'));

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');

      await expect(transcribeAudio(audioBuffer)).rejects.toThrow('ffmpeg not installed');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      // File cleanup should still happen
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should throw error on whisper-cli binary missing', async () => {
      const audioBuffer = Buffer.from('mock audio data');

      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg --version check succeeds
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg succeeds
        .mockRejectedValueOnce(new Error('Command failed'));  // whisper-cli --version check fails

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');

      await expect(transcribeAudio(audioBuffer)).rejects.toThrow('whisper-cli not installed');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      // File cleanup should still happen
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should clean up temp files even if unlink fails', async () => {
      const audioBuffer = Buffer.from('mock audio data');
      const transcriptionText = 'Test transcription';

      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg --version check
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // whisper-cli --version check
        .mockResolvedValueOnce({ stdout: transcriptionText, stderr: '' });  // whisper-cli

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('File deletion failed');
      });

      // Should not throw despite cleanup error
      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe(transcriptionText);
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should trim whitespace from transcription result', async () => {
      const audioBuffer = Buffer.from('mock audio data');
      const transcriptionText = 'Test transcription';

      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg --version check
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // ffmpeg
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // whisper-cli --version check
        .mockResolvedValueOnce({ stdout: `  ${transcriptionText}  \n`, stderr: '' });  // whisper-cli

      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      const mockUnlinkSync = vi.mocked(fs.unlinkSync);

      const { transcribeAudio } = await import('../voice-transcriber.js');
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe(transcriptionText);
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });
  });
});
