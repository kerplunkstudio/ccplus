import React from 'react';

const ReactMarkdown: React.FC<{ children: string }> = ({ children }) => {
  return <div data-testid="markdown">{children}</div>;
};

export default ReactMarkdown;
