# Verification Before Completion

## Iron Law

No agent may claim work is complete without fresh verification evidence.

## Requirements

1. If you changed code: show the test output (not "tests should pass")
2. If you fixed a bug: show the reproduction failing before AND passing after
3. If you created a plan: confirm the user approved the direction
4. If you reviewed code: reference the specific diff you reviewed

## Banned Completion Language

These phrases are NEVER acceptable in a completion claim:
- "should work" / "should be fixed"
- "probably works"
- "seems to be working"
- "I believe this fixes"
- "this likely resolves"

Instead: "Test suite passes (14/14). The fix addresses [root cause] by [change]."

## Why This Exists

Agents historically claimed completion without verification, leading to broken commits and wasted time. Every ban above corresponds to a documented failure mode.
