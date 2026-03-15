import React, { useState, useEffect } from 'react';
import './ProfilePanel.css';

export interface ProfileSettings {
  name: string;
  kindOfWork: string;
  chatFont: string;
}

const PROFILE_STORAGE_KEY = 'ccplus_profile_settings';

const KIND_OF_WORK_OPTIONS = [
  'Software Engineer',
  'Data Scientist',
  'Designer',
  'Product Manager',
  'DevOps',
  'Student',
  'Other',
];

const CHAT_FONT_OPTIONS = [
  { label: 'System Default', value: 'system' },
  { label: 'Mono', value: 'mono' },
  { label: 'Sans-Serif', value: 'sans' },
  { label: 'Serif', value: 'serif' },
];

const DEFAULT_PROFILE: ProfileSettings = {
  name: '',
  kindOfWork: 'Software Engineer',
  chatFont: 'system',
};

const loadProfile = (): ProfileSettings => {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) return DEFAULT_PROFILE;
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
    };
  } catch (error) {
    console.error('Failed to load profile settings:', error);
    return DEFAULT_PROFILE;
  }
};

const saveProfile = (profile: ProfileSettings): void => {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.error('Failed to save profile settings:', error);
  }
};

export const ProfilePanel: React.FC = () => {
  const [profile, setProfile] = useState<ProfileSettings>(loadProfile);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Save to localStorage whenever profile changes
  useEffect(() => {
    saveProfile(profile);
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    }, 300);

    return () => clearTimeout(timer);
  }, [profile]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile((prev) => ({
      ...prev,
      name: e.target.value,
    }));
  };

  const handleKindOfWorkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProfile((prev) => ({
      ...prev,
      kindOfWork: e.target.value,
    }));
  };

  const handleChatFontChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProfile((prev) => ({
      ...prev,
      chatFont: e.target.value,
    }));
  };

  return (
    <div className="profile-panel">
      <div className="profile-header">
        <h1 className="profile-title">Profile</h1>
        {saveStatus === 'saved' && (
          <span className="profile-save-indicator">Saved</span>
        )}
      </div>

      <div className="profile-form">
        <div className="profile-field">
          <label htmlFor="profile-name" className="profile-label">
            NAME
          </label>
          <input
            id="profile-name"
            type="text"
            className="profile-input"
            placeholder="Enter your name"
            value={profile.name}
            onChange={handleNameChange}
          />
        </div>

        <div className="profile-field">
          <label htmlFor="profile-work" className="profile-label">
            KIND OF WORK
          </label>
          <select
            id="profile-work"
            className="profile-select"
            value={profile.kindOfWork}
            onChange={handleKindOfWorkChange}
          >
            {KIND_OF_WORK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="profile-field">
          <label htmlFor="profile-font" className="profile-label">
            CHAT FONT
          </label>
          <select
            id="profile-font"
            className="profile-select"
            value={profile.chatFont}
            onChange={handleChatFontChange}
          >
            {CHAT_FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="profile-font-preview" data-font={profile.chatFont}>
            The quick brown fox jumps over the lazy dog
          </div>
        </div>
      </div>

      <div className="profile-divider" />

      <div className="profile-info">
        <p className="profile-info-text">
          Your profile settings are stored locally in your browser and persist
          across sessions. The chat font selection will update your message
          display in real-time.
        </p>
      </div>
    </div>
  );
};

// Export hook to get current profile
export const useProfile = (): ProfileSettings => {
  const [profile, setProfile] = useState<ProfileSettings>(loadProfile);

  useEffect(() => {
    const handleStorageChange = () => {
      setProfile(loadProfile());
    };

    window.addEventListener('storage', handleStorageChange);

    // Poll for changes from the same window (storage event doesn't fire for same window)
    const interval = setInterval(() => {
      const current = loadProfile();
      setProfile((prev) => {
        if (JSON.stringify(prev) !== JSON.stringify(current)) {
          return current;
        }
        return prev;
      });
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  return profile;
};
