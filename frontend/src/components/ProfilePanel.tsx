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
  {
    label: 'System Default',
    value: 'system',
    family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
    preview: 'The quick brown fox jumps over the lazy dog',
  },
  {
    label: 'Mono',
    value: 'mono',
    family: 'var(--font-mono)',
    preview: 'The quick brown fox jumps over the lazy dog',
  },
  {
    label: 'Sans-Serif',
    value: 'sans',
    family: 'var(--font-sans)',
    preview: 'The quick brown fox jumps over the lazy dog',
  },
  {
    label: 'Serif',
    value: 'serif',
    family: 'var(--font-serif)',
    preview: 'The quick brown fox jumps over the lazy dog',
  },
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
  } catch {
    return DEFAULT_PROFILE;
  }
};

const saveProfile = (profile: ProfileSettings): void => {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Silent fail for localStorage errors
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

  const handleKindOfWorkSelect = (work: string) => {
    setProfile((prev) => ({
      ...prev,
      kindOfWork: work,
    }));
  };

  const handleChatFontSelect = (font: string) => {
    setProfile((prev) => ({
      ...prev,
      chatFont: font,
    }));
  };

  // Extract first letter for avatar
  const avatarLetter = profile.name.trim() ? profile.name.trim()[0].toUpperCase() : '?';

  return (
    <div className="profile-panel">
      <div className="profile-container">
        {/* Typographic Avatar Hero */}
        <div className="profile-avatar-section">
          <div className="profile-avatar" aria-label={`Avatar for ${profile.name || 'unnamed user'}`}>
            <span className="profile-avatar-letter">{avatarLetter}</span>
          </div>
          {saveStatus === 'saved' && (
            <span className="profile-save-indicator" role="status" aria-live="polite">
              Auto-saved
            </span>
          )}
        </div>

        {/* Section 01: Identity */}
        <section className="profile-section" style={{ animationDelay: '0.1s' }}>
          <div className="profile-section-header">
            <span className="profile-section-number" aria-hidden="true">01</span>
            <label htmlFor="profile-name" className="profile-label">
              IDENTITY
            </label>
          </div>
          <input
            id="profile-name"
            type="text"
            className="profile-input"
            placeholder="Your name"
            value={profile.name}
            onChange={handleNameChange}
            aria-label="Your name"
          />
        </section>

        {/* Section 02: Work */}
        <section className="profile-section" style={{ animationDelay: '0.2s' }}>
          <div className="profile-section-header">
            <span className="profile-section-number" aria-hidden="true">02</span>
            <div className="profile-label">KIND OF WORK</div>
          </div>
          <div
            className="profile-pills"
            role="radiogroup"
            aria-label="Select your kind of work"
          >
            {KIND_OF_WORK_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={profile.kindOfWork === option}
                className={`profile-pill ${profile.kindOfWork === option ? 'profile-pill-selected' : ''}`}
                onClick={() => handleKindOfWorkSelect(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        {/* Section 03: Typography */}
        <section className="profile-section" style={{ animationDelay: '0.3s' }}>
          <div className="profile-section-header">
            <span className="profile-section-number" aria-hidden="true">03</span>
            <div className="profile-label">CHAT TYPOGRAPHY</div>
          </div>
          <div
            className="profile-font-cards"
            role="radiogroup"
            aria-label="Select chat font"
          >
            {CHAT_FONT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={profile.chatFont === option.value}
                className={`profile-font-card ${profile.chatFont === option.value ? 'profile-font-card-selected' : ''}`}
                onClick={() => handleChatFontSelect(option.value)}
              >
                <div className="profile-font-card-label">{option.label}</div>
                <div
                  className="profile-font-card-preview"
                  style={{ fontFamily: option.family }}
                >
                  {option.preview}
                </div>
              </button>
            ))}
          </div>
        </section>
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
