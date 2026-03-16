// Placeholder — QualOps provider uses its own system prompt internally.
// References a var so promptfoo passes vars through to the provider.
module.exports = function (context) {
  return 'Review file: {{filePath}}';
};
