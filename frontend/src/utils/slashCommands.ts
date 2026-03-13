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
 * Check if the cursor is in a position to show autocomplete
 */
export function shouldShowAutocomplete(input: string, cursorPosition: number): boolean {
  // Only show if cursor is at the end or within the command name
  const beforeCursor = input.slice(0, cursorPosition);
  const afterCursor = input.slice(cursorPosition);

  // Must start with /
  if (!beforeCursor.startsWith('/')) {
    return false;
  }

  // Don't show if there are multiple lines before cursor
  if (beforeCursor.includes('\n')) {
    return false;
  }

  // Don't show if cursor is after whitespace (user is typing arguments)
  const commandPart = beforeCursor.slice(1);
  if (commandPart.includes(' ')) {
    return false;
  }

  return true;
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
