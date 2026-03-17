import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { ProfilePanel, useProfile } from './ProfilePanel';

describe('ProfilePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders without crashing', () => {
    render(<ProfilePanel />);

    expect(screen.getByText('IDENTITY')).toBeInTheDocument();
    expect(screen.getByText('KIND OF WORK')).toBeInTheDocument();
    expect(screen.getByText('CHAT TYPOGRAPHY')).toBeInTheDocument();
  });

  it('renders section numbers', () => {
    render(<ProfilePanel />);

    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
    expect(screen.getByText('03')).toBeInTheDocument();
  });

  it('renders default avatar letter as question mark when name is empty', () => {
    render(<ProfilePanel />);

    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('updates avatar letter when name is entered', async () => {
    
    render(<ProfilePanel />);

    const nameInput = screen.getByPlaceholderText('Your name');
    fireEvent.change(nameInput, { target: { value: 'Alice' } });

    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('allows selecting kind of work', async () => {
    
    render(<ProfilePanel />);

    // Default is Software Engineer
    const engineerButton = screen.getByRole('radio', { name: 'Software Engineer' });
    expect(engineerButton).toHaveAttribute('aria-checked', 'true');

    const designerButton = screen.getByRole('radio', { name: 'Designer' });
    fireEvent.click(designerButton);

    expect(designerButton).toHaveAttribute('aria-checked', 'true');
    expect(engineerButton).toHaveAttribute('aria-checked', 'false');
  });

  it('allows selecting chat font', async () => {

    render(<ProfilePanel />);

    // Get all font option buttons
    const fontButtons = screen.getAllByRole('radio').filter((el: HTMLElement) => {
      return el.className.includes('profile-font-card');
    });

    const systemButton = fontButtons[0]; // System Default
    const monoButton = fontButtons[1]; // Mono

    expect(systemButton).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(monoButton);

    expect(monoButton).toHaveAttribute('aria-checked', 'true');
    expect(systemButton).toHaveAttribute('aria-checked', 'false');
  });

  it('saves profile to localStorage', async () => {
    
    render(<ProfilePanel />);

    const nameInput = screen.getByPlaceholderText('Your name');
    fireEvent.change(nameInput, { target: { value: 'Bob' } });

    // Advance timers to trigger save
    jest.advanceTimersByTime(2000);

    const saved = localStorage.getItem('ccplus_profile_settings');
    expect(saved).toBeTruthy();

    const profile = JSON.parse(saved!);
    expect(profile.name).toBe('Bob');
  });

  it('loads profile from localStorage', () => {
    const savedProfile = {
      name: 'Charlie',
      kindOfWork: 'Designer',
      chatFont: 'mono',
    };
    localStorage.setItem('ccplus_profile_settings', JSON.stringify(savedProfile));

    render(<ProfilePanel />);

    expect(screen.getByPlaceholderText('Your name')).toHaveValue('Charlie');
    expect(screen.getByRole('radio', { name: 'Designer' })).toHaveAttribute('aria-checked', 'true');

    const fontButtons = screen.getAllByRole('radio').filter((el: HTMLElement) => {
      return el.className.includes('profile-font-card');
    });
    const monoButton = fontButtons[1];
    expect(monoButton).toHaveAttribute('aria-checked', 'true');
  });

  it('shows auto-saved indicator after changes', async () => {
    
    render(<ProfilePanel />);

    const nameInput = screen.getByPlaceholderText('Your name');
    fireEvent.change(nameInput, { target: { value: 'Dave' } });

    // Advance timers to trigger save animation
    jest.advanceTimersByTime(500);

    await waitFor(() => {
      expect(screen.getByText('Auto-saved')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('renders all kind of work options', () => {
    render(<ProfilePanel />);

    expect(screen.getByRole('radio', { name: 'Software Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Data Scientist' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Designer' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Product Manager' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'DevOps' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Student' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Other' })).toBeInTheDocument();
  });

  it('renders all font options', () => {
    render(<ProfilePanel />);

    const fontButtons = screen.getAllByRole('radio').filter((el: HTMLElement) => {
      return el.className.includes('profile-font-card');
    });

    expect(fontButtons.length).toBe(4);
  });

  it('displays font previews', () => {
    render(<ProfilePanel />);

    const previews = screen.getAllByText('The quick brown fox jumps over the lazy dog');
    expect(previews.length).toBe(4); // One for each font option
  });

  it('updates multiple fields independently', async () => {

    render(<ProfilePanel />);

    const nameInput = screen.getByPlaceholderText('Your name');
    fireEvent.change(nameInput, { target: { value: 'Eve' } });

    const dataScientistButton = screen.getByRole('radio', { name: 'Data Scientist' });
    fireEvent.click(dataScientistButton);

    const fontButtons = screen.getAllByRole('radio').filter((el: HTMLElement) => {
      return el.className.includes('profile-font-card');
    });
    const serifButton = fontButtons[3]; // Serif is the 4th font option
    fireEvent.click(serifButton);

    jest.advanceTimersByTime(2000);

    const saved = localStorage.getItem('ccplus_profile_settings');
    const profile = JSON.parse(saved!);

    expect(profile.name).toBe('Eve');
    expect(profile.kindOfWork).toBe('Data Scientist');
    expect(profile.chatFont).toBe('serif');
  });

  it('handles empty name gracefully', () => {
    render(<ProfilePanel />);

    const avatar = screen.getByLabelText(/Avatar for unnamed user/i);
    expect(avatar).toBeInTheDocument();
  });

  it('handles localStorage errors gracefully', () => {
    // Mock localStorage to throw error
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = jest.fn(() => {
      throw new Error('Storage full');
    });

    render(<ProfilePanel />);

    // Should not crash
    expect(screen.getByText('IDENTITY')).toBeInTheDocument();

    Storage.prototype.setItem = originalSetItem;
  });
});

describe('useProfile', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('returns default profile when localStorage is empty', () => {
    const TestComponent = () => {
      const profile = useProfile();
      return <div>{profile.name || 'empty'}</div>;
    };

    render(<TestComponent />);
    expect(screen.getByText('empty')).toBeInTheDocument();
  });

  it('returns saved profile from localStorage', () => {
    const savedProfile = {
      name: 'Frank',
      kindOfWork: 'DevOps',
      chatFont: 'sans',
    };
    localStorage.setItem('ccplus_profile_settings', JSON.stringify(savedProfile));

    const TestComponent = () => {
      const profile = useProfile();
      return <div>{profile.name}</div>;
    };

    render(<TestComponent />);
    expect(screen.getByText('Frank')).toBeInTheDocument();
  });

  it('handles corrupted localStorage data', () => {
    localStorage.setItem('ccplus_profile_settings', 'invalid json{');

    const TestComponent = () => {
      const profile = useProfile();
      return <div>{profile.kindOfWork}</div>;
    };

    render(<TestComponent />);
    expect(screen.getByText('Software Engineer')).toBeInTheDocument(); // default
  });
});
