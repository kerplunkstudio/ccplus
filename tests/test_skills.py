"""Tests for skill execution module."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import Mock, patch, MagicMock
from backend.skills import SkillExecutor


class TestSkillExecutor:
    """Test skill execution functionality."""

    @pytest.fixture
    def executor(self):
        """Create a SkillExecutor instance for testing."""
        with patch('backend.skills.SkillExecutor._find_claude_binary') as mock_find:
            mock_find.return_value = '/usr/local/bin/claude'
            return SkillExecutor()

    def test_init(self, executor):
        """Test executor initialization."""
        assert executor.claude_bin == '/usr/local/bin/claude'

    def test_find_claude_binary_in_common_location(self):
        """Test finding Claude binary in common locations."""
        with patch('pathlib.Path.exists') as mock_exists:
            mock_exists.return_value = True
            executor = SkillExecutor()
            # Should find in one of the common paths
            assert 'claude' in executor.claude_bin

    @patch('subprocess.run')
    def test_execute_skill_success(self, mock_run, executor):
        """Test successful skill execution."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = 'Skill executed successfully\n'
        mock_result.stderr = ''
        mock_run.return_value = mock_result

        result = executor.execute_skill('polish', 'file.py')

        assert result['success'] is True
        assert 'Skill executed successfully' in result['output']
        assert result['skill'] == 'polish'
        mock_run.assert_called_once()

    @patch('subprocess.run')
    def test_execute_skill_failure(self, mock_run, executor):
        """Test skill execution failure."""
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ''
        mock_result.stderr = 'Skill not found\n'
        mock_run.return_value = mock_result

        result = executor.execute_skill('nonexistent')

        assert result['success'] is False
        assert 'Skill not found' in result['error']
        assert result['skill'] == 'nonexistent'

    @patch('subprocess.run')
    def test_execute_skill_timeout(self, mock_run, executor):
        """Test skill execution timeout."""
        from subprocess import TimeoutExpired
        mock_run.side_effect = TimeoutExpired('claude', 60)

        result = executor.execute_skill('slow_skill')

        assert result['success'] is False
        assert 'timed out' in result['error'].lower()
        assert result['skill'] == 'slow_skill'

    @patch('subprocess.run')
    def test_execute_skill_with_workspace(self, mock_run, executor):
        """Test skill execution with workspace."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = 'Success\n'
        mock_result.stderr = ''
        mock_run.return_value = mock_result

        workspace = '/path/to/workspace'
        result = executor.execute_skill('polish', workspace=workspace)

        assert result['success'] is True
        # Verify workspace was passed to subprocess
        call_kwargs = mock_run.call_args[1]
        assert call_kwargs['cwd'] == workspace

    @patch('subprocess.run')
    def test_get_skill_list_success(self, mock_run, executor):
        """Test getting skill list."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '[{"name": "polish"}, {"name": "distill"}]'
        mock_result.stderr = ''
        mock_run.return_value = mock_result

        result = executor.get_skill_list()

        assert result['success'] is True
        assert len(result['skills']) == 2
        assert result['skills'][0]['name'] == 'polish'

    @patch('subprocess.run')
    def test_get_skill_list_invalid_json(self, mock_run, executor):
        """Test skill list with invalid JSON."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = 'not valid json'
        mock_result.stderr = ''
        mock_run.return_value = mock_result

        result = executor.get_skill_list()

        assert result['success'] is False
        assert 'Invalid JSON' in result['error']

    @patch('subprocess.run')
    def test_get_skill_info_success(self, mock_run, executor):
        """Test getting skill info."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '{"name": "polish", "description": "Polish code"}'
        mock_result.stderr = ''
        mock_run.return_value = mock_result

        result = executor.get_skill_info('polish')

        assert result['success'] is True
        assert result['skill']['name'] == 'polish'
        assert 'description' in result['skill']

    def test_run_command_timeout(self, executor):
        """Test command timeout handling."""
        with patch('subprocess.run') as mock_run:
            from subprocess import TimeoutExpired
            mock_run.side_effect = TimeoutExpired('claude', 5)

            result = executor._run_command(['skill', 'list'], timeout=5)

            assert result['success'] is False
            assert 'timed out' in result['error'].lower()

    def test_run_command_exception(self, executor):
        """Test command exception handling."""
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = Exception('Command failed')

            result = executor._run_command(['skill', 'list'])

            assert result['success'] is False
            assert 'Command failed' in result['error']
