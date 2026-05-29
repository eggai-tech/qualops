'use strict';

/**
 * One model call response in the unstructured (prose) pipeline.
 *
 * Not one issue — one complete response from the model. In file-by-file mode
 * there is one ProseReview per file; the content may describe several issues
 * or say "no issues found." The pipeline never attempts to parse the prose into
 * individual issue objects — the entire response is the unit.
 */
export interface ProseReview {
  /** The file being reviewed, or null for whole-PR / agentic scope. */
  file: string | null;
  passName: string;
  /** Full prose response from the model. May describe zero or more issues. */
  content: string;
}
