export function formatHelpText(): string {
  return `
Analysis Modes:
  Git Mode (default):    Analyzes changed files between git refs
  Files Mode:            Analyzes specific files/patterns

Examples:
  # Git Mode (MR/PR Review)
  $ qualops                                    # Changed files (main...HEAD)
  $ qualops --base development                # Changed files (development...HEAD)
  $ qualops --base main --head feature        # Compare branches (main...feature)
  $ qualops --base HEAD                       # Uncommitted changes only

  # Files Mode (Targeted Analysis)
  $ qualops --files path/to/file.ts           # Specific file
  $ qualops --files "file1.ts,file2.ts"       # Multiple files
  $ qualops --files "src/**/*.ts"             # Glob pattern
  $ qualops --files "libs/my-lib/src/**/*.ts" # Library files

  # Stage Control
  $ qualops -s analyze,review                 # Run specific stages
  $ qualops -s fix --fix-apply                # Generate and apply fixes

  # Custom Options
  $ qualops --name my-session                 # Custom session name
  $ qualops --report-root custom-reports      # Custom report directory
  $ qualops --skip-cache                      # Force fresh analysis

Stage Dependencies:
  - review depends on: analyze
  - fix depends on: review
  - report depends on: analyze, review
  - judge depends on: report, fix
`;
}
