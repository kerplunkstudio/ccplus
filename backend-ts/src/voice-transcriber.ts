import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

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

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const tmpOgg = path.join(os.tmpdir(), `ccplus-voice-${Date.now()}.ogg`);
  const tmpWav = path.join(os.tmpdir(), `ccplus-voice-${Date.now()}.wav`);

  try {
    // Save OGG file
    fs.writeFileSync(tmpOgg, audioBuffer);

    // Convert OGG Opus to WAV using ffmpeg
    // Telegram sends OGG Opus which whisper-cli can't decode
    // We need 16kHz, mono, PCM s16le WAV
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    if (!process.env.FFMPEG_PATH) {
      log.warn('FFMPEG_PATH not set, using system PATH to resolve ffmpeg');
    }

    await execFileAsync(ffmpegPath, [
      '-y',                    // Overwrite output file
      '-i', tmpOgg,            // Input file
      '-ar', '16000',          // Sample rate 16kHz
      '-ac', '1',              // Mono
      '-c:a', 'pcm_s16le',     // PCM signed 16-bit little-endian
      tmpWav                   // Output file
    ]);

    // Run whisper-cli on the WAV file
    const whisperCliPath = process.env.WHISPER_CLI_PATH || 'whisper-cli';
    const modelPath = process.env.WHISPER_MODEL_PATH;

    if (!process.env.WHISPER_CLI_PATH) {
      log.warn('WHISPER_CLI_PATH not set, using system PATH to resolve whisper-cli');
    }
    if (!modelPath) {
      log.warn('WHISPER_MODEL_PATH not set, whisper-cli may fail without model path');
    }

    const whisperArgs = modelPath
      ? ['-m', modelPath, '-f', tmpWav, '--no-timestamps']
      : ['-f', tmpWav, '--no-timestamps'];

    const { stdout } = await execFileAsync(whisperCliPath, whisperArgs);

    return stdout.trim();
  } catch (error) {
    log.error('Whisper transcription error', { error: String(error) });
    return '';
  } finally {
    // Clean up both temp files
    try { fs.unlinkSync(tmpOgg); } catch { /* ignore cleanup errors */ }
    try { fs.unlinkSync(tmpWav); } catch { /* ignore cleanup errors */ }
  }
}
