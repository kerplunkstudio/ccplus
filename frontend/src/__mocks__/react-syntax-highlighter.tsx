import React from 'react';

export const Prism: React.FC<{ children: string; language?: string }> = ({ children }) => {
  return <pre data-testid="syntax-highlighter">{children}</pre>;
};

export default Prism;
