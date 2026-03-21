import { pipeline } from '@xenova/transformers';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './logger.js';

// Lazy-initialized pipeline (downloads model on first call ~39MB for tiny model)
let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getTranscriber() {
  if (!transcriber) {
    log.info('Loading Whisper model (first run may take a moment)...');
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    log.info('Whisper model loaded');
  }
  return transcriber;
}

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
  const tmpFile = path.join(os.tmpdir(), `ccplus-voice-${Date.now()}.ogg`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
    const pipe = await getTranscriber();
    const result = await (pipe as any)(tmpFile);
    return result.text ?? '';
  } catch (error) {
    log.error('Whisper transcription error', { error: String(error) });
    return '';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
  }
}
