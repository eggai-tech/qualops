/** File paths, file content, and positions/snippets within source code. */

export type FilePath = string;

export type FileContent = {
  path: FilePath;
  content: string;
  encoding?: string;
  size?: number;
};

export type CodeLocation = {
  file: FilePath;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type CodeSnippet = CodeLocation & {
  code: string;
  language?: string;
};
