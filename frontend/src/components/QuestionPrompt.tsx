import React, { useState, useEffect } from 'react';
import './QuestionPrompt.css';

interface QuestionPromptProps {
  pendingQuestion: {
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiSelect: boolean;
    }>;
    toolUseId: string;
  };
  onRespondToQuestion: (response: Record<string, string>) => void;
}

export const QuestionPrompt: React.FC<QuestionPromptProps> = ({
  pendingQuestion,
  onRespondToQuestion,
}) => {
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({});

  // Reset selections when question changes
  useEffect(() => {
    setQuestionSelections({});
  }, [pendingQuestion]);

  const handleConfirm = () => {
    const answers: Record<string, string> = {};
    pendingQuestion.questions.forEach((q, i) => {
      const sel = questionSelections[i] || [];
      answers[q.question] = sel.join(', ') || 'No selection';
    });
    onRespondToQuestion(answers);
  };

  const isDisabled = Object.keys(questionSelections).length === 0 ||
                      Object.values(questionSelections).every(s => s.length === 0);

  return (
    <div className="user-question-prompt" role="form" aria-label="Answer required questions">
      {pendingQuestion.questions.map((q, qIndex) => (
        <fieldset key={qIndex} className="question-block">
          <legend className="question-header">{q.header}</legend>
          <div className="question-text">{q.question}</div>
          <div className="question-options" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
            {q.options.map((option, oIndex) => {
              const selected = (questionSelections[qIndex] || []).includes(option.label);
              return (
                <button
                  key={oIndex}
                  className={`question-option ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    setQuestionSelections(prev => {
                      const current = prev[qIndex] || [];
                      if (q.multiSelect) {
                        const next = selected
                          ? current.filter(l => l !== option.label)
                          : [...current, option.label];
                        return { ...prev, [qIndex]: next };
                      }
                      return { ...prev, [qIndex]: [option.label] };
                    });
                  }}
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                >
                  <span className="option-indicator" aria-hidden="true">
                    {q.multiSelect ? (selected ? '☑' : '☐') : (selected ? '●' : '○')}
                  </span>
                  <span className="option-content">
                    <span className="option-label">{option.label}</span>
                    <span className="option-description">{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <button
        className="question-submit"
        onClick={handleConfirm}
        disabled={isDisabled}
        aria-label="Confirm selections"
      >
        Confirm
      </button>
    </div>
  );
};
