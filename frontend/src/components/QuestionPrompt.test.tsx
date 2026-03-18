import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionPrompt } from './QuestionPrompt';
import { PendingQuestion } from '../types';

describe('QuestionPrompt', () => {
  const singleSelectQuestion: PendingQuestion = {
    questions: [
      {
        question: 'Which option do you prefer?',
        header: 'Selection Required',
        options: [
          { label: 'Option A', description: 'First choice' },
          { label: 'Option B', description: 'Second choice' },
          { label: 'Option C', description: 'Third choice' },
        ],
        multiSelect: false,
      },
    ],
    toolUseId: 'tool_123',
  };

  const multiSelectQuestion: PendingQuestion = {
    questions: [
      {
        question: 'Select all that apply',
        header: 'Multiple Selections',
        options: [
          { label: 'Feature A', description: 'Enable feature A' },
          { label: 'Feature B', description: 'Enable feature B' },
          { label: 'Feature C', description: 'Enable feature C' },
        ],
        multiSelect: true,
      },
    ],
    toolUseId: 'tool_456',
  };

  const multipleQuestions: PendingQuestion = {
    questions: [
      {
        question: 'First question?',
        header: 'Question 1',
        options: [
          { label: 'Yes', description: 'Affirmative' },
          { label: 'No', description: 'Negative' },
        ],
        multiSelect: false,
      },
      {
        question: 'Second question?',
        header: 'Question 2',
        options: [
          { label: 'Maybe', description: 'Uncertain' },
          { label: 'Definitely', description: 'Certain' },
        ],
        multiSelect: false,
      },
    ],
    toolUseId: 'tool_789',
  };

  const defaultProps = {
    pendingQuestion: singleSelectQuestion,
    onRespondToQuestion: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the question prompt', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByRole('form', { name: 'Answer required questions' })).toBeInTheDocument();
    });

    it('renders question header', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByText('Selection Required')).toBeInTheDocument();
    });

    it('renders question text', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByText('Which option do you prefer?')).toBeInTheDocument();
    });

    it('renders all options', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByText('Option A')).toBeInTheDocument();
      expect(screen.getByText('Option B')).toBeInTheDocument();
      expect(screen.getByText('Option C')).toBeInTheDocument();
    });

    it('renders option descriptions', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByText('First choice')).toBeInTheDocument();
      expect(screen.getByText('Second choice')).toBeInTheDocument();
      expect(screen.getByText('Third choice')).toBeInTheDocument();
    });

    it('renders confirm button', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Confirm selections' })).toBeInTheDocument();
    });

    it('renders multiple questions', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multipleQuestions} />);
      expect(screen.getByText('Question 1')).toBeInTheDocument();
      expect(screen.getByText('Question 2')).toBeInTheDocument();
      expect(screen.getByText('First question?')).toBeInTheDocument();
      expect(screen.getByText('Second question?')).toBeInTheDocument();
    });

    it('uses radiogroup role for single select', () => {
      render(<QuestionPrompt {...defaultProps} />);
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    });

    it('uses group role for multi select', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const groups = screen.getAllByRole('group');
      expect(groups.length).toBeGreaterThan(0);
    });
  });

  describe('Single Select Interactions', () => {
    it('shows radio indicators for single select', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const options = screen.getAllByRole('radio');
      expect(options).toHaveLength(3);
    });

    it('selects an option when clicked', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });

      fireEvent.click(optionA);

      expect(optionA).toHaveAttribute('aria-checked', 'true');
    });

    it('deselects previous option when selecting new one', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });
      const optionB = screen.getByRole('radio', { name: /Option B/ });

      fireEvent.click(optionA);
      expect(optionA).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(optionB);
      expect(optionA).toHaveAttribute('aria-checked', 'false');
      expect(optionB).toHaveAttribute('aria-checked', 'true');
    });

    it('adds selected class to selected option', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });

      fireEvent.click(optionA);

      expect(optionA).toHaveClass('selected');
    });

    it('shows filled radio indicator when selected', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });

      fireEvent.click(optionA);

      const indicator = optionA.querySelector('.option-indicator');
      expect(indicator).toHaveTextContent('●');
    });

    it('shows empty radio indicator when not selected', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionB = screen.getByRole('radio', { name: /Option B/ });

      const indicator = optionB.querySelector('.option-indicator');
      expect(indicator).toHaveTextContent('○');
    });
  });

  describe('Multi Select Interactions', () => {
    it('shows checkbox indicators for multi select', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const options = screen.getAllByRole('checkbox');
      expect(options).toHaveLength(3);
    });

    it('selects multiple options when clicked', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const featureA = screen.getByRole('checkbox', { name: /Feature A/ });
      const featureB = screen.getByRole('checkbox', { name: /Feature B/ });

      fireEvent.click(featureA);
      fireEvent.click(featureB);

      expect(featureA).toHaveAttribute('aria-checked', 'true');
      expect(featureB).toHaveAttribute('aria-checked', 'true');
    });

    it('deselects option when clicked again', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const featureA = screen.getByRole('checkbox', { name: /Feature A/ });

      fireEvent.click(featureA);
      expect(featureA).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(featureA);
      expect(featureA).toHaveAttribute('aria-checked', 'false');
    });

    it('shows checked checkbox indicator when selected', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const featureA = screen.getByRole('checkbox', { name: /Feature A/ });

      fireEvent.click(featureA);

      const indicator = featureA.querySelector('.option-indicator');
      expect(indicator).toHaveTextContent('☑');
    });

    it('shows unchecked checkbox indicator when not selected', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const featureB = screen.getByRole('checkbox', { name: /Feature B/ });

      const indicator = featureB.querySelector('.option-indicator');
      expect(indicator).toHaveTextContent('☐');
    });
  });

  describe('Submit Behavior', () => {
    it('disables confirm button when no selection', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const confirmBtn = screen.getByRole('button', { name: 'Confirm selections' });
      expect(confirmBtn).toBeDisabled();
    });

    it('enables confirm button after selection', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm selections' });

      fireEvent.click(optionA);

      expect(confirmBtn).not.toBeDisabled();
    });

    it('calls onRespondToQuestion with single selection', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm selections' });

      fireEvent.click(optionA);
      fireEvent.click(confirmBtn);

      expect(defaultProps.onRespondToQuestion).toHaveBeenCalledWith({
        'Which option do you prefer?': 'Option A',
      });
    });

    it('calls onRespondToQuestion with multiple selections', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);
      const featureA = screen.getByRole('checkbox', { name: /Feature A/ });
      const featureC = screen.getByRole('checkbox', { name: /Feature C/ });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm selections' });

      fireEvent.click(featureA);
      fireEvent.click(featureC);
      fireEvent.click(confirmBtn);

      expect(defaultProps.onRespondToQuestion).toHaveBeenCalledWith({
        'Select all that apply': 'Feature A, Feature C',
      });
    });

    it('calls onRespondToQuestion with multiple question answers', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multipleQuestions} />);
      const yesOption = screen.getByRole('radio', { name: /Yes/ });
      const maybeOption = screen.getByRole('radio', { name: /Maybe/ });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm selections' });

      fireEvent.click(yesOption);
      fireEvent.click(maybeOption);
      fireEvent.click(confirmBtn);

      expect(defaultProps.onRespondToQuestion).toHaveBeenCalledWith({
        'First question?': 'Yes',
        'Second question?': 'Maybe',
      });
    });

    it('sends "No selection" for unanswered questions', () => {
      render(<QuestionPrompt {...defaultProps} pendingQuestion={multipleQuestions} />);
      const yesOption = screen.getByRole('radio', { name: /Yes/ });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm selections' });

      // Only answer first question
      fireEvent.click(yesOption);
      fireEvent.click(confirmBtn);

      expect(defaultProps.onRespondToQuestion).toHaveBeenCalledWith({
        'First question?': 'Yes',
        'Second question?': 'No selection',
      });
    });
  });

  describe('State Management', () => {
    it('resets selections when pendingQuestion changes', () => {
      const { rerender } = render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });

      fireEvent.click(optionA);
      expect(optionA).toHaveAttribute('aria-checked', 'true');

      // Change to different question
      rerender(<QuestionPrompt {...defaultProps} pendingQuestion={multiSelectQuestion} />);

      // New question should have no selections
      const featureA = screen.getByRole('checkbox', { name: /Feature A/ });
      expect(featureA).toHaveAttribute('aria-checked', 'false');
    });

    it('maintains selections within same question', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const optionA = screen.getByRole('radio', { name: /Option A/ });

      fireEvent.click(optionA);
      expect(optionA).toHaveAttribute('aria-checked', 'true');

      // Click another component to trigger re-render
      const optionB = screen.getByRole('radio', { name: /Option B/ });
      fireEvent.click(optionB);

      // optionB should now be selected
      expect(optionB).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('Accessibility', () => {
    it('uses semantic fieldset and legend', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const fieldsets = document.querySelectorAll('fieldset');
      expect(fieldsets.length).toBeGreaterThan(0);
      const legend = fieldsets[0]?.querySelector('legend');
      expect(legend).toHaveTextContent('Selection Required');
    });

    it('has aria-label on form', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const form = screen.getByRole('form');
      expect(form).toHaveAttribute('aria-label', 'Answer required questions');
    });

    it('has aria-label on options container', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const radiogroup = screen.getByRole('radiogroup');
      expect(radiogroup).toHaveAttribute('aria-label', 'Which option do you prefer?');
    });

    it('has aria-checked attribute on options', () => {
      render(<QuestionPrompt {...defaultProps} />);
      const options = screen.getAllByRole('radio');
      options.forEach(option => {
        expect(option).toHaveAttribute('aria-checked');
      });
    });

    it('hides indicator from screen readers', () => {
      const { container } = render(<QuestionPrompt {...defaultProps} />);
      const indicator = container.querySelector('.option-indicator');
      expect(indicator).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Edge Cases', () => {
    it('handles question with no options', () => {
      const emptyQuestion: PendingQuestion = {
        questions: [
          {
            question: 'Empty question',
            header: 'No Options',
            options: [],
            multiSelect: false,
          },
        ],
        toolUseId: 'tool_empty',
      };
      render(<QuestionPrompt {...defaultProps} pendingQuestion={emptyQuestion} />);
      expect(screen.getByText('Empty question')).toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('handles question with single option', () => {
      const singleOption: PendingQuestion = {
        questions: [
          {
            question: 'Single option',
            header: 'One Choice',
            options: [{ label: 'Only Option', description: 'The only choice' }],
            multiSelect: false,
          },
        ],
        toolUseId: 'tool_single',
      };
      render(<QuestionPrompt {...defaultProps} pendingQuestion={singleOption} />);
      expect(screen.getByRole('radio', { name: /Only Option/ })).toBeInTheDocument();
    });

    it('handles long option labels', () => {
      const longLabel: PendingQuestion = {
        questions: [
          {
            question: 'Which do you prefer?',
            header: 'Long Options',
            options: [
              {
                label: 'This is a very long option label that should wrap properly',
                description: 'Long description text',
              },
            ],
            multiSelect: false,
          },
        ],
        toolUseId: 'tool_long',
      };
      render(<QuestionPrompt {...defaultProps} pendingQuestion={longLabel} />);
      expect(screen.getByText('This is a very long option label that should wrap properly')).toBeInTheDocument();
    });

    it('handles empty option description', () => {
      const noDescription: PendingQuestion = {
        questions: [
          {
            question: 'Choose one',
            header: 'No Descriptions',
            options: [{ label: 'Option A', description: '' }],
            multiSelect: false,
          },
        ],
        toolUseId: 'tool_no_desc',
      };
      render(<QuestionPrompt {...defaultProps} pendingQuestion={noDescription} />);
      const option = screen.getByRole('radio', { name: /Option A/ });
      const description = option.querySelector('.option-description');
      expect(description).toHaveTextContent('');
    });
  });
});
