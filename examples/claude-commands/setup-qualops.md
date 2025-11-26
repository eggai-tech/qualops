Fetch the QualOps configuration guide from:
https://raw.githubusercontent.com/eggai-tech/qualops/main/qualops-llm.txt

Use this guide to help me set up QualOps for this project. Follow the INTERACTIVE SETUP PROCESS from the guide, asking me questions about:
- Review focus (security, performance, code quality, etc.)
- Framework detection
- CI platform (GitHub Actions or GitLab CI)
- Validation and confidence settings

Then create:
1. `.qualopsrc.json` - Main configuration
2. CI workflow file (`.github/workflows/qualops.yml` or `.gitlab-ci.yml`)
3. Custom prompts in `prompts/` directory if needed
