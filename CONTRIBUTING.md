# Contributing to Sensoriqua

Thank you for your interest in contributing.

## Before you push (especially to a public repo)

- **Never commit secrets.** Ensure no `.env` or other files with real credentials are staged:
  ```bash
  git status   # confirm backend/.env and any .env files do not appear
  git check-ignore -v backend/.env   # should show backend/.env is ignored
  ```
- If `.env` or any file with a DSN/password was **ever** committed, remove it from history (e.g. `git filter-branch` or BFG) and **rotate the credentials** (new DB password, new API keys) immediately.
- Only `backend/.env.example` (placeholders only) should be in the repo.

## Development setup

1. Clone the repository.
2. Follow the [Quick start](README.md#quick-start-local-testing) in the main README to set up the database, backend, and frontend.
3. Use `backend/.env.example` to create `backend/.env` with your DSN. **Do not commit `.env` or any real credentials.**

**Optional — strip co-author lines from commit messages:** To remove automatically added co-author lines from commit messages, install:  
`cp scripts/prepare-commit-msg .git/hooks/prepare-commit-msg && chmod +x .git/hooks/prepare-commit-msg`

## Code and pull requests

- **Backend**: Python 3.10+; style with Black or the project’s formatter. Use parameterized SQL only; never concatenate user input into SQL.
- **Frontend**: TypeScript + React; run `npm run lint` in `frontend/` before submitting.
- **Security**: Do not add secrets, hardcoded credentials, or unsafe use of user input. See [SECURITY.md](SECURITY.md) for guidelines.
- Open a pull request with a clear description. Keep changes focused where possible.

## Reporting issues

- Use GitHub Issues for bugs and feature requests.
- For security vulnerabilities, prefer a private report (e.g. security advisory or contact maintainers) rather than a public issue.

## License

By contributing, you agree that your contributions will be licensed under the same [MIT License](LICENSE) that covers this project.
