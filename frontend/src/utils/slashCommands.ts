/**
 * Slash command parsing utilities
 */

export interface SlashCommand {
  command: string;
  arguments: string;
  isComplete: boolean;
}

export interface SkillSuggestion {
  name: string;
  plugin: string;
  description?: string;
}

export interface SlashCommandAtCursor {
  start: number;
  command: string;
}

/**
 * Parse a potential slash command from input text
 */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  const parts = withoutSlash.split(/\s+/, 1);
  const command = parts[0] || '';
  const arguments_text = withoutSlash.slice(command.length).trim();

  return {
    command,
    arguments: arguments_text,
    isComplete: command.length > 0,
  };
}

/**
 * Find a slash command at the current cursor position
 * Returns the start position and partial command text, or null if no valid slash command is at cursor
 */
export function findSlashCommandAtCursor(input: string, cursorPosition: number): SlashCommandAtCursor | null {
  // Cursor at position 0 - no command possible
  if (cursorPosition === 0) {
    return null;
  }

  // Scan backwards from cursor to find the start of a potential slash command
  let start = cursorPosition;

  // Move backwards to find the beginning of the current token
  while (start > 0 && !/\s/.test(input[start - 1])) {
    start--;
  }

  // Check if the token starts with /
  if (start >= input.length || input[start] !== '/') {
    return null;
  }

  // Extract the text from / to cursor (excluding the /)
  const commandText = input.slice(start + 1, cursorPosition);

  // Don't allow whitespace in the command name
  if (commandText.includes(' ')) {
    return null;
  }

  // Don't allow newlines between / and cursor
  if (commandText.includes('\n')) {
    return null;
  }

  return {
    start,
    command: commandText,
  };
}

/**
 * Check if the cursor is in a position to show autocomplete
 */
export function shouldShowAutocomplete(input: string, cursorPosition: number): boolean {
  return findSlashCommandAtCursor(input, cursorPosition) !== null;
}

/**
 * Filter skills based on partial command input
 */
export function filterSkills(
  skills: SkillSuggestion[],
  partialCommand: string
): SkillSuggestion[] {
  if (!partialCommand) {
    return skills;
  }

  const lower = partialCommand.toLowerCase();

  return skills.filter((skill) =>
    skill.name.toLowerCase().includes(lower) ||
    skill.plugin.toLowerCase().includes(lower) ||
    (skill.description && skill.description.toLowerCase().includes(lower))
  ).sort((a, b) => {
    // Prioritize exact prefix matches
    const aStartsWith = a.name.toLowerCase().startsWith(lower);
    const bStartsWith = b.name.toLowerCase().startsWith(lower);

    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;

    // Then alphabetical
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get built-in commands
 *
 * Note: All slash commands (including built-in ones) are now handled
 * directly by the Claude Code SDK. This function is kept for autocomplete
 * suggestions only.
 */
export function getBuiltInCommands(): SkillSuggestion[] {
  return [];
}

/**
 * Combine built-in commands with skill suggestions
 */
export function getAllSuggestions(skills: SkillSuggestion[]): SkillSuggestion[] {
  return [...getBuiltInCommands(), ...skills];
}
