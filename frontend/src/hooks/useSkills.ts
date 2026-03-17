import { useState, useEffect, useCallback } from 'react';
import { SkillSuggestion } from '../utils/slashCommands';
import { SkillData } from '../types';

const API_BASE = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export function useSkills() {
  const [skills, setSkills] = useState<SkillSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/skills`);
      if (!response.ok) {
        throw new Error('Failed to load skills');
      }
      const data = await response.json();

      const skillSuggestions: SkillSuggestion[] = (data.skills || []).map((skill: SkillData) => ({
        name: skill.name,
        plugin: skill.plugin,
        description: skill.description || `From ${skill.plugin}`,
      }));

      setSkills(skillSuggestions);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  return {
    skills,
    loading,
    error,
    reload: loadSkills,
  };
}
