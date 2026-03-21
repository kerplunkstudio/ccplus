/**
 * Telegram message formatting utilities.
 * Converts standard markdown to Telegram MarkdownV2 and splits long messages.
 */

const TELEGRAM_MAX_LENGTH = 4096;

// MarkdownV2 special characters that need escaping outside of code blocks
const MD_V2_SPECIAL = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape text for Telegram MarkdownV2 (outside code blocks).
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MD_V2_SPECIAL, '\\$1');
}

/**
 * Convert standard markdown to Telegram MarkdownV2.
 * Handles: bold, italic, code, code blocks, links, strikethrough.
 * Falls back gracefully — if conversion produces invalid markup, returns escaped plain text.
 */
export function convertToTelegramMarkdown(text: string): string {
  // Extract code blocks first to protect them
  const codeBlocks: string[] = [];
  let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `\x00CODE${codeBlocks.length}\x00`;
    // In MarkdownV2 code blocks, only ` and \ need escaping
    const escapedCode = code.replace(/([`\\])/g, '\\$1');
    const langTag = lang ? lang : '';
    codeBlocks.push(`\`\`\`${langTag}\n${escapedCode}\`\`\``);
    return placeholder;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
    const placeholder = `\x00INLINE${inlineCodes.length}\x00`;
    const escapedCode = code.replace(/([`\\])/g, '\\$1');
    inlineCodes.push(`\`${escapedCode}\``);
    return placeholder;
  });

  // Escape all special characters in remaining text
  processed = escapeMarkdownV2(processed);

  // Convert markdown formatting (after escaping, so we unescape the markers we want)
  // Bold: **text** or __text__
  processed = processed.replace(/\\\*\\\*(.+?)\\\*\\\*/g, '*$1*');
  processed = processed.replace(/\\_\\_(.+?)\\_\\_/g, '*$1*');

  // Italic: *text* or _text_
  processed = processed.replace(/\\\*(.+?)\\\*/g, '_$1_');
  processed = processed.replace(/\\_(.+?)\\_/g, '_$1_');

  // Strikethrough: ~~text~~
  processed = processed.replace(/\\~\\~(.+?)\\~\\~/g, '~$1~');

  // Links: [text](url)
  processed = processed.replace(/\\\[(.+?)\\\]\\\((.+?)\\\)/g, '[$1]($2)');

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    processed = processed.replace(`\x00CODE${i}\x00`, codeBlocks[i]);
  }

  // Restore inline code
  for (let i = 0; i < inlineCodes.length; i++) {
    processed = processed.replace(`\x00INLINE${i}\x00`, inlineCodes[i]);
  }

  return processed;
}

/**
 * Split a message into chunks that fit within Telegram's message limit.
 * Splits at paragraph boundaries first, then line boundaries, then hard splits.
 * Never splits inside code blocks.
 */
export function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_LENGTH): readonly string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = -1;

    // Try paragraph break
    const paraSearch = remaining.lastIndexOf('\n\n', maxLength);
    if (paraSearch > maxLength * 0.3) {
      splitIndex = paraSearch;
    }

    // Try line break
    if (splitIndex === -1) {
      const lineSearch = remaining.lastIndexOf('\n', maxLength);
      if (lineSearch > maxLength * 0.3) {
        splitIndex = lineSearch;
      }
    }

    // Try sentence boundary
    if (splitIndex === -1) {
      const sentenceSearch = remaining.lastIndexOf('. ', maxLength);
      if (sentenceSearch > maxLength * 0.3) {
        splitIndex = sentenceSearch + 1; // Keep the period
      }
    }

    // Hard split as last resort
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Format a Captain response for Telegram.
 * Converts markdown and returns split chunks ready to send.
 */
export function formatForTelegram(text: string): readonly string[] {
  const formatted = convertToTelegramMarkdown(text);
  return splitMessage(formatted);
}
