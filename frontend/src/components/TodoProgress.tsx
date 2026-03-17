import React, { useState, useEffect, useRef } from 'react';
import { TodoItem } from '../types';
import './TodoProgress.css';

interface TodoProgressProps {
  todos: TodoItem[];
  onDismiss: () => void;
}

export const TodoProgress: React.FC<TodoProgressProps> = ({ todos, onDismiss }) => {
  const [dismissing, setDismissing] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAllCompleteRef = useRef(false);

  const allComplete = todos.length > 0 && todos.every(t => t.status === 'completed');
  const completedCount = todos.filter(t => t.status === 'completed').length;

  useEffect(() => {
    if (allComplete && !prevAllCompleteRef.current) {
      // All just completed - start dismiss sequence
      dismissTimerRef.current = setTimeout(() => {
        setDismissing(true);
        setTimeout(() => {
          onDismiss();
        }, 500); // fade out duration
      }, 1500); // hold duration
    }
    prevAllCompleteRef.current = allComplete;

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [allComplete, onDismiss]);

  if (todos.length === 0) return null;

  return (
    <div className={`todo-progress ${dismissing ? 'todo-progress--dismissing' : ''} ${allComplete ? 'todo-progress--complete' : ''}`}>
      <div className="todo-progress__header">
        <span className="todo-progress__counter">{completedCount}/{todos.length}</span>
      </div>
      <div className="todo-progress__list">
        {todos.map((todo, i) => (
          <div key={i} className={`todo-progress__item todo-progress__item--${todo.status}`}>
            <span className="todo-progress__icon">
              {todo.status === 'completed' && '✓'}
              {todo.status === 'in_progress' && '→'}
              {todo.status === 'pending' && '○'}
            </span>
            <span className="todo-progress__text">
              {todo.status === 'in_progress' ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
