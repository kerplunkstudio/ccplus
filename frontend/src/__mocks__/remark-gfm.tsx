// Mock for remark-gfm plugin
// In tests, we don't need actual GFM parsing, just a no-op plugin
const remarkGfm = () => {
  return (tree: any) => tree;
};

export default remarkGfm;
