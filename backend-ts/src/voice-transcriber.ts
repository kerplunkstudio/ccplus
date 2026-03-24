import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

// Track whether we've warned about missing dependencies
let whisperBinaryWarningShown = false;
let whisperConfigWarningShown = false;
let ffmpegBinaryWarningShown = false;
let ffmpegConfigWarningShown = false;

export async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer> {
  // Step 1: Get file path from Telegram API
  const fileInfoJson = await fetchJson(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const filePath: string = fileInfoJson.result.file_path;

  // Step 2: Download file bytes
  return fetchBuffer(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading file`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Check if a binary exists in PATH or at specified path
 */
async function checkBinaryExists(binaryPath: string): Promise<boolean> {
  // For absolute paths, use fs.accessSync to check executable existence
  if (path.isAbsolute(binaryPath)) {
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  // For relative paths (like 'ffmpeg' or 'whisper-cli'), try running with --version
  try {
    await execFileAsync(binaryPath, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const tmpOgg = path.join(os.tmpdir(), `ccplus-voice-${Date.now()}.ogg`);
  const tmpWav = path.join(os.tmpdir(), `ccplus-voice-${Date.now()}.wav`);

  try {
    // Save OGG file
    fs.writeFileSync(tmpOgg, audioBuffer);

    // Check ffmpeg availability
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    const ffmpegExists = await checkBinaryExists(ffmpegPath);

    if (!ffmpegExists) {
      if (!ffmpegBinaryWarningShown) {
        log.error('ffmpeg not found — voice transcription unavailable', {
          path: ffmpegPath,
          install: 'Run: brew install ffmpeg'
        });
        ffmpegBinaryWarningShown = true;
      }
      throw new Error('ffmpeg not installed. Install with: brew install ffmpeg');
    }

    if (!process.env.FFMPEG_PATH && !ffmpegConfigWarningShown) {
      log.debug('FFMPEG_PATH not set, using system PATH to resolve ffmpeg');
      ffmpegConfigWarningShown = true;
    }

    // Convert OGG Opus to WAV using ffmpeg
    // Telegram sends OGG Opus which whisper-cli can't decode
    // We need 16kHz, mono, PCM s16le WAV
    await execFileAsync(ffmpegPath, [
      '-y',                    // Overwrite output file
      '-i', tmpOgg,            // Input file
      '-ar', '16000',          // Sample rate 16kHz
      '-ac', '1',              // Mono
      '-c:a', 'pcm_s16le',     // PCM signed 16-bit little-endian
      tmpWav                   // Output file
    ]);

    // Check whisper-cli availability
    const whisperCliPath = process.env.WHISPER_CLI_PATH || 'whisper-cli';
    const whisperExists = await checkBinaryExists(whisperCliPath);

    if (!whisperExists) {
      if (!whisperBinaryWarningShown) {
        log.error('whisper-cli not found — voice transcription unavailable', {
          path: whisperCliPath,
          install: 'Run: brew install whisper-cpp'
        });
        whisperBinaryWarningShown = true;
      }
      throw new Error('whisper-cli not installed. Install with: brew install whisper-cpp');
    }

    const modelPath = process.env.WHISPER_MODEL_PATH;

    if (!process.env.WHISPER_CLI_PATH && !whisperConfigWarningShown) {
      log.debug('WHISPER_CLI_PATH not set, using system PATH to resolve whisper-cli');
      whisperConfigWarningShown = true;
    }
    if (!modelPath && !whisperConfigWarningShown) {
      log.warn('WHISPER_MODEL_PATH not set, using whisper-cli default model');
      whisperConfigWarningShown = true;
    }

    const whisperArgs = modelPath
      ? ['-m', modelPath, '-f', tmpWav, '--no-timestamps']
      : ['-f', tmpWav, '--no-timestamps'];

    const { stdout } = await execFileAsync(whisperCliPath, whisperArgs);

    return stdout.trim();
  } catch (error) {
    const errorMsg = String(error);
    log.error('Voice transcription error', { error: errorMsg });

    // Re-throw with user-friendly message for missing binaries
    if (errorMsg.includes('whisper-cli not installed')) {
      throw new Error('Voice transcription unavailable: whisper-cli not installed. Run: brew install whisper-cpp');
    }
    if (errorMsg.includes('ffmpeg not installed')) {
      throw new Error('Voice transcription unavailable: ffmpeg not installed. Run: brew install ffmpeg');
    }

    // Generic transcription error
    throw new Error('Voice transcription failed. Check server logs for details.');
  } finally {
    // Clean up both temp files
    try { fs.unlinkSync(tmpOgg); } catch { /* ignore cleanup errors */ }
    try { fs.unlinkSync(tmpWav); } catch { /* ignore cleanup errors */ }
  }
}
