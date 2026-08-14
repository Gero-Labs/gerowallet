# Contributing to GeroWallet

Thank you for your interest in contributing to GeroWallet! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/gerowallet.git
   cd gerowallet
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy environment template:
   ```bash
   cp .env.example .env.development
   ```
5. Start development server:
   ```bash
   npm run dev
   ```
6. Load extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/` folder

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/Gero-Labs/gerowallet/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Browser/OS version

### Suggesting Features

1. Check existing [Issues](https://github.com/Gero-Labs/gerowallet/issues) for similar suggestions
2. Create a new issue with:
   - Clear description of the feature
   - Use cases and benefits
   - Any implementation ideas

### Pull Requests

1. Create a new branch from `development`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes following our coding standards
3. Write or update tests as needed
4. Ensure all tests pass:
   ```bash
   npm run typecheck
   npm run lint
   ```
5. Commit with clear messages:
   ```bash
   git commit -m "feat: add new feature description"
   ```
6. Push to your fork and create a Pull Request

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Coding Standards

### General Guidelines

- Write TypeScript with proper type annotations
- Follow existing code patterns and conventions
- Keep functions small and focused
- Add comments for complex logic
- Use meaningful variable and function names

### Vue Components

- Use Composition API (`<script setup>`) for new components
- Follow Vuetify 2.7 patterns
- Use i18n for all user-facing text: `$t('key')`
- Keep templates readable with proper indentation

### Security

- **Never log sensitive data** (passwords, keys, mnemonics)
- Validate all user inputs
- Keep private key operations in background script
- Follow existing cryptographic patterns

### Testing

- Write unit tests for utilities and services
- Test edge cases and error conditions
- Ensure tests are deterministic

## Project Structure

```
src/
├── chrome/          # Extension background & messaging
├── modules/         # Feature modules (Vue components)
├── stores/          # State management
├── services/        # Business logic
├── db/              # Database layer
├── api/             # External API integrations
└── shared/          # Reusable utilities
```

## Need Help?

- Review the [README](README.md) for setup instructions
- Check [CLAUDE.md](CLAUDE.md) for detailed technical documentation
- Ask questions in [Issues](https://github.com/Gero-Labs/gerowallet/issues)

## License

By contributing, you agree that your contributions will be licensed under the project's [Apache License 2.0](LICENSE) (Copyright A.D. Labs), consistent with Section 5 of that license.
