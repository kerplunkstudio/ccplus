import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../git-operations.js';

describe('parseUnifiedDiff', () => {
  it('should return empty array for empty string', () => {
    const result = parseUnifiedDiff('');
    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only string', () => {
    const result = parseUnifiedDiff('   \n  \n  ');
    expect(result).toEqual([]);
  });

  it('should parse a simple modified file diff', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('test.txt');
    expect(result[0].status).toBe('modified');
    expect(result[0].additions).toBe(1);
    expect(result[0].deletions).toBe(1);
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].oldStart).toBe(1);
    expect(result[0].hunks[0].newStart).toBe(1);
    // The hunk has 4 lines: context, deletion, addition, context
    expect(result[0].hunks[0].lines).toHaveLength(4);
  });

  it('should parse a new file diff', () => {
    const diff = `diff --git a/new-file.txt b/new-file.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/new-file.txt
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('new-file.txt');
    expect(result[0].status).toBe('added');
    expect(result[0].additions).toBe(3);
    expect(result[0].deletions).toBe(0);
  });

  it('should parse a deleted file diff', () => {
    const diff = `diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
index 1234567..0000000
--- a/deleted.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-line 1
-line 2
-line 3`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('deleted.txt');
    expect(result[0].status).toBe('deleted');
    expect(result[0].additions).toBe(0);
    expect(result[0].deletions).toBe(3);
  });

  it('should parse a renamed file diff', () => {
    const diff = `diff --git a/old-name.txt b/new-name.txt
similarity index 100%
rename from old-name.txt
rename to new-name.txt`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('new-name.txt');
    expect(result[0].status).toBe('renamed');
    expect(result[0].oldPath).toBe('old-name.txt');
  });

  it('should parse a binary file diff', () => {
    const diff = `diff --git a/image.png b/image.png
index 1234567..abcdefg 100644
Binary files a/image.png and b/image.png differ`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('image.png');
    expect(result[0].hunks).toHaveLength(0);
    expect(result[0].additions).toBe(0);
    expect(result[0].deletions).toBe(0);
  });

  it('should parse multiple files', () => {
    const diff = `diff --git a/file1.txt b/file1.txt
index 1234567..abcdefg 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,2 +1,2 @@
-old line
+new line
 same line
diff --git a/file2.txt b/file2.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/file2.txt
@@ -0,0 +1,1 @@
+content`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('file1.txt');
    expect(result[0].status).toBe('modified');
    expect(result[1].path).toBe('file2.txt');
    expect(result[1].status).toBe('added');
  });

  it('should track line numbers correctly in additions', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,4 @@
 line 1
+new line 2
+new line 3
 line 2`;

    const result = parseUnifiedDiff(diff);

    expect(result[0].hunks[0].lines).toHaveLength(4);

    // Context line
    expect(result[0].hunks[0].lines[0].type).toBe('context');
    expect(result[0].hunks[0].lines[0].oldLineNumber).toBe(1);
    expect(result[0].hunks[0].lines[0].newLineNumber).toBe(1);

    // First addition
    expect(result[0].hunks[0].lines[1].type).toBe('addition');
    expect(result[0].hunks[0].lines[1].oldLineNumber).toBe(null);
    expect(result[0].hunks[0].lines[1].newLineNumber).toBe(2);

    // Second addition
    expect(result[0].hunks[0].lines[2].type).toBe('addition');
    expect(result[0].hunks[0].lines[2].oldLineNumber).toBe(null);
    expect(result[0].hunks[0].lines[2].newLineNumber).toBe(3);

    // Context line
    expect(result[0].hunks[0].lines[3].type).toBe('context');
    expect(result[0].hunks[0].lines[3].oldLineNumber).toBe(2);
    expect(result[0].hunks[0].lines[3].newLineNumber).toBe(4);
  });

  it('should track line numbers correctly in deletions', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,4 +1,2 @@
 line 1
-line 2
-line 3
 line 4`;

    const result = parseUnifiedDiff(diff);

    expect(result[0].hunks[0].lines).toHaveLength(4);

    // Context line
    expect(result[0].hunks[0].lines[0].type).toBe('context');
    expect(result[0].hunks[0].lines[0].oldLineNumber).toBe(1);
    expect(result[0].hunks[0].lines[0].newLineNumber).toBe(1);

    // First deletion
    expect(result[0].hunks[0].lines[1].type).toBe('deletion');
    expect(result[0].hunks[0].lines[1].oldLineNumber).toBe(2);
    expect(result[0].hunks[0].lines[1].newLineNumber).toBe(null);

    // Second deletion
    expect(result[0].hunks[0].lines[2].type).toBe('deletion');
    expect(result[0].hunks[0].lines[2].oldLineNumber).toBe(3);
    expect(result[0].hunks[0].lines[2].newLineNumber).toBe(null);

    // Context line
    expect(result[0].hunks[0].lines[3].type).toBe('context');
    expect(result[0].hunks[0].lines[3].oldLineNumber).toBe(4);
    expect(result[0].hunks[0].lines[3].newLineNumber).toBe(2);
  });

  it('should parse multiple hunks in a single file', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
@@ -10,3 +10,3 @@
 line 10
-line 11
+line 11 modified
 line 12`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].hunks[0].oldStart).toBe(1);
    expect(result[0].hunks[1].oldStart).toBe(10);
  });

  it('should handle hunk headers with labels', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@ function name()
 line 1
-line 2
+line 2 modified
 line 3`;

    const result = parseUnifiedDiff(diff);

    expect(result[0].hunks[0].header).toBe('function name()');
  });

  it('should handle files with paths containing spaces', () => {
    const diff = `diff --git a/path with spaces.txt b/path with spaces.txt
index 1234567..abcdefg 100644
--- a/path with spaces.txt
+++ b/path with spaces.txt
@@ -1,1 +1,1 @@
-old
+new`;

    const result = parseUnifiedDiff(diff);

    expect(result[0].path).toBe('path with spaces.txt');
  });

  it('should count total additions and deletions correctly', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,5 +1,6 @@
 line 1
-line 2
-line 3
+line 2 modified
+line 2.5 added
+line 3 modified
 line 4
 line 5`;

    const result = parseUnifiedDiff(diff);

    expect(result[0].additions).toBe(3);
    expect(result[0].deletions).toBe(2);
  });

  it('should handle empty hunks gracefully', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt`;

    const result = parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(0);
  });

  it('should preserve content after leading symbols', () => {
    const diff = `diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 normal line
-  line with spaces
+  line with different spaces
 another line`;

    const result = parseUnifiedDiff(diff);

    expect(result[0].hunks[0].lines[0].content).toBe('normal line');
    expect(result[0].hunks[0].lines[1].content).toBe('  line with spaces');
    expect(result[0].hunks[0].lines[2].content).toBe('  line with different spaces');
  });
});
