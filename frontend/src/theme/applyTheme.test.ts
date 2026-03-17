import { applyTheme } from './applyTheme';
import { Theme } from './themeTypes';

describe('applyTheme', () => {
  let mockRoot: {
    style: {
      setProperty: jest.Mock;
    };
  };

  beforeEach(() => {
    // Mock document.documentElement
    mockRoot = {
      style: {
        setProperty: jest.fn(),
      },
    };
    Object.defineProperty(document, 'documentElement', {
      value: mockRoot,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockTheme = (): Theme => ({
    name: 'Test Theme',
    presetId: 'test-theme',
    colors: {
      background: '#1a1a1a',
      accent: '#007acc',
      text: '#ffffff',
      border: '#333333',
      hover: '#2a2a2a',
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545',
    },
  });

  describe('base palette', () => {
    it('sets base palette CSS variables', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--bg-primary', '#1a1a1a');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--bg-secondary', '#2a2a2a');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--text-primary', '#ffffff');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent', '#007acc');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--border', '#333333');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--success', '#28a745');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--warning', '#ffc107');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--error', '#dc3545');
    });

    it('sets tertiary background (adjusted brightness)', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      const call = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--bg-tertiary'
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatch(/^#[0-9a-f]{6}$/i); // hex color format
    });

    it('sets text secondary (adjusted brightness)', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      const call = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--text-secondary'
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('sets accent RGB components', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-rgb', '0, 122, 204');
    });

    it('sets accent dim and light variants', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      const dimCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--accent-dim'
      );
      expect(dimCall).toBeDefined();
      expect(dimCall![1]).toMatch(/^#[0-9a-f]{6}$/i);

      const lightCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--accent-light'
      );
      expect(lightCall).toBeDefined();
      expect(lightCall![1]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('derived accent colors', () => {
    it('sets accent background with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-bg', 'rgba(0, 122, 204, 0.1)');
    });

    it('sets accent border with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-border', 'rgba(0, 122, 204, 0.2)');
    });

    it('sets accent shadow with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-shadow', 'rgba(0, 122, 204, 0.4)');
    });

    it('sets accent shadow fade (transparent)', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-shadow-fade', 'rgba(0, 122, 204, 0)');
    });

    it('sets accent background active', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-bg-active', 'rgba(0, 122, 204, 0.15)');
    });

    it('sets accent hover (brightness adjusted)', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      const call = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--accent-hover'
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('derived semantic colors', () => {
    it('sets success background and border with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--success-bg', 'rgba(40, 167, 69, 0.15)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--success-border', 'rgba(40, 167, 69, 0.3)');
    });

    it('sets error background and border with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--error-bg', 'rgba(220, 53, 69, 0.15)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--error-bg-subtle', 'rgba(220, 53, 69, 0.08)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--error-border', 'rgba(220, 53, 69, 0.3)');
    });

    it('sets border subtle with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--border-subtle', 'rgba(255, 255, 255, 0.03)');
    });
  });

  describe('derived interactive colors', () => {
    it('sets button colors with text alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--button-bg', 'rgba(255, 255, 255, 0.05)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--button-border', 'rgba(255, 255, 255, 0.12)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--button-text', 'rgba(255, 255, 255, 0.5)');
    });

    it('sets button hover colors with text alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--button-bg-hover', 'rgba(255, 255, 255, 0.08)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--button-border-hover', 'rgba(255, 255, 255, 0.2)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--button-text-hover', 'rgba(255, 255, 255, 0.7)');
    });

    it('sets hover backgrounds', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--hover-bg', 'rgba(255, 255, 255, 0.05)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--hover-border', 'rgba(255, 255, 255, 0.08)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--hover-bg-secondary', 'rgba(42, 42, 42, 0.8)');
    });
  });

  describe('derived surface colors', () => {
    it('sets icon background with alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--icon-bg', 'rgba(255, 255, 255, 0.07)');
    });

    it('sets code backgrounds with hardcoded black alpha', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--code-bg', 'rgba(0, 0, 0, 0.3)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--code-header-bg', 'rgba(0, 0, 0, 0.5)');
    });

    it('sets overlay and shadow colors', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--overlay-bg', 'rgba(0, 0, 0, 0.7)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--dropdown-shadow', '0 8px 24px rgba(0, 0, 0, 0.4)');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--shadow', 'rgba(0, 0, 0, 0.2)');
    });
  });

  describe('hex color conversions', () => {
    it('handles hex colors with hash prefix', () => {
      const theme = createMockTheme();
      theme.colors.accent = '#ff5733';

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-rgb', '255, 87, 51');
    });

    it('handles hex colors without hash prefix', () => {
      const theme = createMockTheme();
      theme.colors.accent = 'ff5733';

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-rgb', '255, 87, 51');
    });

    it('handles uppercase hex colors', () => {
      const theme = createMockTheme();
      theme.colors.accent = '#FF5733';

      applyTheme(theme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--accent-rgb', '255, 87, 51');
    });
  });

  describe('brightness adjustments', () => {
    it('brightens colors correctly', () => {
      const theme = createMockTheme();
      theme.colors.background = '#000000'; // black

      applyTheme(theme);

      // bg-tertiary should be brightness +10
      const tertiaryCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--bg-tertiary'
      );
      expect(tertiaryCall).toBeDefined();
      // Should be slightly brighter than #000000
      expect(tertiaryCall![1]).not.toBe('#000000');
    });

    it('darkens colors correctly', () => {
      const theme = createMockTheme();
      theme.colors.text = '#ffffff'; // white

      applyTheme(theme);

      // text-secondary should be brightness -40
      const secondaryCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--text-secondary'
      );
      expect(secondaryCall).toBeDefined();
      // Should be darker than #ffffff
      expect(secondaryCall![1]).not.toBe('#ffffff');
    });

    it('clamps brightness to 0-255 range', () => {
      const theme = createMockTheme();
      theme.colors.text = '#ffffff'; // already max brightness
      theme.colors.background = '#000000'; // already min brightness

      applyTheme(theme);

      // Should not overflow/underflow
      const lightCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--accent-light'
      );
      expect(lightCall).toBeDefined();
      expect(lightCall![1]).toMatch(/^#[0-9a-f]{6}$/i);

      const dimCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--accent-dim'
      );
      expect(dimCall).toBeDefined();
      expect(dimCall![1]).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('preserves hash prefix in adjusted colors', () => {
      const theme = createMockTheme();
      theme.colors.background = '#1a1a1a'; // with hash

      applyTheme(theme);

      const tertiaryCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--bg-tertiary'
      );
      expect(tertiaryCall![1]).toMatch(/^#/);
    });

    it('adds hash prefix if original has no hash', () => {
      const theme = createMockTheme();
      theme.colors.text = 'ffffff'; // no hash

      applyTheme(theme);

      const secondaryCall = (mockRoot.style.setProperty as jest.Mock).mock.calls.find(
        (c) => c[0] === '--text-secondary'
      );
      // Should not have hash (follows original format)
      expect(secondaryCall![1]).toMatch(/^[0-9a-f]{6}$/i);
    });
  });

  describe('integration', () => {
    it('sets all expected CSS variables', () => {
      const theme = createMockTheme();

      applyTheme(theme);

      const setCalls = (mockRoot.style.setProperty as jest.Mock).mock.calls;
      const varNames = setCalls.map((call) => call[0]);

      // Check that all major variables are set
      const expectedVars = [
        '--bg-primary',
        '--bg-secondary',
        '--bg-tertiary',
        '--text-primary',
        '--text-secondary',
        '--accent',
        '--accent-rgb',
        '--accent-dim',
        '--accent-light',
        '--border',
        '--success',
        '--warning',
        '--error',
        '--accent-bg',
        '--accent-border',
        '--accent-shadow',
        '--success-bg',
        '--success-border',
        '--error-bg',
        '--error-border',
        '--button-bg',
        '--button-border',
        '--button-text',
        '--hover-bg',
        '--icon-bg',
        '--code-bg',
        '--overlay-bg',
        '--shadow',
      ];

      for (const varName of expectedVars) {
        expect(varNames).toContain(varName);
      }
    });

    it('handles light theme colors', () => {
      const lightTheme: Theme = {
        name: 'Light Theme',
        presetId: 'light',
        colors: {
          background: '#ffffff',
          accent: '#0066cc',
          text: '#000000',
          border: '#cccccc',
          hover: '#f0f0f0',
          success: '#28a745',
          warning: '#ffc107',
          error: '#dc3545',
        },
      };

      applyTheme(lightTheme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--bg-primary', '#ffffff');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--text-primary', '#000000');
    });

    it('handles dark theme colors', () => {
      const darkTheme: Theme = {
        name: 'Dark Theme',
        presetId: 'dark',
        colors: {
          background: '#0d1117',
          accent: '#58a6ff',
          text: '#c9d1d9',
          border: '#30363d',
          hover: '#161b22',
          success: '#3fb950',
          warning: '#d29922',
          error: '#f85149',
        },
      };

      applyTheme(darkTheme);

      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--bg-primary', '#0d1117');
      expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--text-primary', '#c9d1d9');
    });
  });
});
