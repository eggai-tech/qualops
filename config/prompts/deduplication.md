# Issue Deduplication

Identify duplicate issues in the provided list. All issues are from the SAME file.

<issues>
{{ISSUES_LIST}}
</issues>

<rules>
Mark as duplicate ONLY if:
- Same line number (±1 line) **AND** same bug description
- Identical issue with different wording

Keep separate if:
- Different line numbers (>1 line apart) - these are separate instances
- Different bugs even if related
- Different root causes even if same area

Same bug pattern at different locations are NOT duplicates.

**When in doubt, keep both.**
</rules>
