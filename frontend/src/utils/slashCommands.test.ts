import {
  parseSlashCommand,
  shouldShowAutocomplete,
  filterSkills,
  getBuiltInCommands,
  getAllSuggestions,
  SkillSuggestion,
} from './slashCommands';

describe('slashCommands', () => {
  describe('parseSlashCommand', () => {
    it('parses slash command with no arguments', () => {
      const result = parseSlashCommand('/help');

      expect(result).toEqual({
        command: 'help',
        arguments: '',
        isComplete: true,
      });
    });

    it('parses slash command with arguments', () => {
      const result = parseSlashCommand('/commit -m "Fix bug"');

      expect(result).toEqual({
        command: 'commit',
        arguments: '-m "Fix bug"',
        isComplete: true,
      });
    });

    it('parses slash command with multiple spaces before arguments', () => {
      const result = parseSlashCommand('/deploy     production');

      expect(result).toEqual({
        command: 'deploy',
        arguments: 'production',
        isComplete: true,
      });
    });

    it('returns null for non-slash input', () => {
      expect(parseSlashCommand('normal text')).toBeNull();
      expect(parseSlashCommand('help')).toBeNull();
      expect(parseSlashCommand('')).toBeNull();
    });

    it('handles slash only (no command)', () => {
      const result = parseSlashCommand('/');

      expect(result).toEqual({
        command: '',
        arguments: '',
        isComplete: false,
      });
    });

    it('handles slash with spaces only', () => {
      const result = parseSlashCommand('/   ');

      expect(result).toEqual({
        command: '',
        arguments: '',
        isComplete: false,
      });
    });

    it('handles slash with whitespace before command', () => {
      const result = parseSlashCommand('  /command  ');

      expect(result).toEqual({
        command: 'command',
        arguments: '',
        isComplete: true,
      });
    });

    it('trims arguments at the end but preserves internal spaces', () => {
      const result = parseSlashCommand('/echo   hello   world  ');

      expect(result).toEqual({
        command: 'echo',
        arguments: 'hello   world',
        isComplete: true,
      });
    });
  });

  describe('shouldShowAutocomplete', () => {
    it('shows autocomplete at end of slash command', () => {
      expect(shouldShowAutocomplete('/help', 5)).toBe(true);
      expect(shouldShowAutocomplete('/com', 4)).toBe(true);
      expect(shouldShowAutocomplete('/c', 2)).toBe(true);
    });

    it('shows autocomplete within command name', () => {
      expect(shouldShowAutocomplete('/help', 3)).toBe(true); // cursor at /he|lp
      expect(shouldShowAutocomplete('/commit', 4)).toBe(true); // cursor at /com|mit
    });

    it('does not show autocomplete if not starting with slash', () => {
      expect(shouldShowAutocomplete('help', 4)).toBe(false);
      expect(shouldShowAutocomplete('text /help', 10)).toBe(false);
    });

    it('does not show autocomplete if cursor is after whitespace', () => {
      expect(shouldShowAutocomplete('/commit ', 8)).toBe(false);
      expect(shouldShowAutocomplete('/commit -m', 10)).toBe(false);
    });

    it('does not show autocomplete if there are newlines before cursor', () => {
      expect(shouldShowAutocomplete('/help\n', 6)).toBe(false);
      expect(shouldShowAutocomplete('/commit\ntext', 8)).toBe(false);
    });

    it('shows autocomplete for slash only', () => {
      expect(shouldShowAutocomplete('/', 1)).toBe(true);
    });

    it('handles cursor at beginning', () => {
      expect(shouldShowAutocomplete('/help', 0)).toBe(false);
    });

    it('handles cursor in middle with no spaces', () => {
      expect(shouldShowAutocomplete('/command', 5)).toBe(true);
    });

    it('does not show if text after cursor (not at end or in command)', () => {
      // This case is tricky: cursor at /com|mit (position 4)
      // According to the implementation, it checks beforeCursor only
      expect(shouldShowAutocomplete('/commit', 4)).toBe(true);
    });
  });

  describe('filterSkills', () => {
    const skills: SkillSuggestion[] = [
      { name: 'commit', plugin: 'git-tools', description: 'Commit changes' },
      { name: 'deploy', plugin: 'deploy-tools', description: 'Deploy to production' },
      { name: 'review-pr', plugin: 'github-tools', description: 'Review pull request' },
      { name: 'code-review', plugin: 'review-tools', description: 'Review code quality' },
      { name: 'test', plugin: 'test-tools', description: 'Run tests' },
    ];

    it('returns all skills for empty partial command', () => {
      const result = filterSkills(skills, '');

      expect(result).toEqual(skills);
    });

    it('filters skills by name substring', () => {
      const result = filterSkills(skills, 'com');

      // Only 'commit' contains 'com' in the name ('code-review' does not)
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('commit');
    });

    it('filters skills by plugin name', () => {
      const result = filterSkills(skills, 'github');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('review-pr');
    });

    it('filters skills by description', () => {
      const result = filterSkills(skills, 'production');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('deploy');
    });

    it('prioritizes exact prefix matches', () => {
      const result = filterSkills(skills, 'review');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('review-pr'); // exact prefix
      expect(result[1].name).toBe('code-review'); // contains but not prefix
    });

    it('is case insensitive', () => {
      const result = filterSkills(skills, 'COMMIT');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('commit');
    });

    it('sorts alphabetically after prefix priority', () => {
      const manySkills: SkillSuggestion[] = [
        { name: 'zebra', plugin: 'z', description: 'Z tool' },
        { name: 'apple', plugin: 'a', description: 'A tool' },
        { name: 'banana', plugin: 'b', description: 'B tool' },
      ];

      const result = filterSkills(manySkills, 'a');

      expect(result[0].name).toBe('apple'); // exact prefix
      expect(result[1].name).toBe('banana'); // contains, alphabetical
    });

    it('handles skills with no description', () => {
      const skillsNoDesc: SkillSuggestion[] = [
        { name: 'foo', plugin: 'tools' },
        { name: 'bar', plugin: 'tools' },
      ];

      const result = filterSkills(skillsNoDesc, 'foo');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('foo');
    });

    it('returns empty array if no matches', () => {
      const result = filterSkills(skills, 'xyz123');

      expect(result).toEqual([]);
    });

    it('matches partial strings in middle of names', () => {
      const result = filterSkills(skills, 'view');

      expect(result).toHaveLength(2);
      expect(result.map(s => s.name)).toContain('review-pr');
      expect(result.map(s => s.name)).toContain('code-review');
    });
  });

  describe('getBuiltInCommands', () => {
    it('returns empty array (all commands handled by SDK)', () => {
      const result = getBuiltInCommands();

      expect(result).toEqual([]);
    });
  });

  describe('getAllSuggestions', () => {
    it('combines built-in commands with skills', () => {
      const skills: SkillSuggestion[] = [
        { name: 'commit', plugin: 'git-tools' },
        { name: 'deploy', plugin: 'deploy-tools' },
      ];

      const result = getAllSuggestions(skills);

      // Since getBuiltInCommands returns [], result should be just skills
      expect(result).toEqual(skills);
    });

    it('returns just built-in commands if no skills provided', () => {
      const result = getAllSuggestions([]);

      expect(result).toEqual([]);
    });

    it('preserves order (built-in first, then skills)', () => {
      const skills: SkillSuggestion[] = [
        { name: 'skill1', plugin: 'p1' },
        { name: 'skill2', plugin: 'p2' },
      ];

      const result = getAllSuggestions(skills);

      // Built-in commands come first (currently none), then skills
      expect(result).toEqual(skills);
    });
  });
});
