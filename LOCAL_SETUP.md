# Local Development Setup Guide

This guide walks through setting up the Innovation Sandbox on AWS project for local development without deploying to AWS.

## Prerequisites

### Required Software

1. **Operating System**
   - macOS or Amazon Linux 2

2. **Node.js 22**
   - Check version: `node --version`
   - Should output: `v22.x.x` or higher
   - Install from: https://nodejs.org/

3. **npm**
   - Comes with Node.js
   - Check version: `npm --version`

### Optional Software

4. **Python 3** (Optional - for pre-commit hooks)
   - Check version: `python3 --version`
   - Install from: https://www.python.org/downloads/

5. **Docker** (Optional - for building custom ECR images)
   - Check version: `docker --version`
   - Install from: https://www.docker.com/products/docker-desktop

6. **pre-commit** (Optional - for automated code quality checks)
   - Requires Python
   - Install: `pip install pre-commit`

## Setup Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd innovation-sandbox-on-aws
```

### 2. Initialize Environment Configuration

Create a `.env` file from the example template:

```bash
npm run env:init
```

This creates a `.env` file in the root directory. You don't need to configure AWS-specific values for local development.

### 3. Install Dependencies

Install all npm dependencies for the monorepo:

```bash
npm install
```

This command will:
- Install root-level dependencies
- Install dependencies for all workspace packages (frontend, infrastructure, lambdas, layers, common)
- Generate package-lock files for individual workspaces
- Take approximately 1-2 minutes

### 4. Build the Project

Compile all TypeScript code:

```bash
npm run build
```

This verifies that all packages compile without errors.

### 5. Run Tests

Execute the test suite:

```bash
npm test
```

To update test snapshots:

```bash
npm run test:update-snapshots
```

### 6. (Optional) Setup Pre-commit Hooks

If you want automated code quality checks before each commit:

```bash
# Install pre-commit (requires Python)
pip install pre-commit

# Install the git hooks
pre-commit install

# Test the hooks (optional)
pre-commit run --all-files
```

## Project Structure

```
innovation-sandbox-on-aws/
├── source/
│   ├── common/              # Shared libraries and utilities
│   ├── frontend/            # React/Vite web application
│   ├── infrastructure/      # AWS CDK infrastructure code
│   ├── lambdas/            # Lambda function implementations
│   └── layers/             # Lambda layers
├── deployment/             # Build scripts for distribution
├── docs/                   # Documentation and diagrams
├── scripts/               # Utility scripts
├── .env                   # Local environment configuration (created by you)
├── .env.example          # Environment template
└── package.json          # Root package configuration
```

## Available npm Scripts

### Development Commands

- `npm run build` - Compile all TypeScript packages
- `npm test` - Run all unit tests with coverage
- `npm run test:update-snapshots` - Update test snapshots
- `npm run clean` - Clean build artifacts (preserves .env and IDE configs)

### Environment Commands

- `npm run env:init` - Create .env file from template

### Deployment Commands (Requires AWS Configuration)

- `npm run bootstrap` - Bootstrap CDK in target AWS accounts
- `npm run deploy:all` - Deploy all stacks
- `npm run deploy:account-pool` - Deploy account pool stack
- `npm run deploy:idc` - Deploy IDC stack
- `npm run deploy:data` - Deploy data stack
- `npm run deploy:compute` - Deploy compute stack

### Docker Commands (Optional)

- `npm run docker:build` - Build account cleaner Docker image
- `npm run docker:login` - Login to ECR
- `npm run docker:push` - Push image to ECR
- `npm run docker:build-and-push` - Build and push in one command

## Working with Individual Packages

### Frontend Development

```bash
cd source/frontend
npm run dev        # Start development server
npm run build      # Build for production
npm run lint       # Run linters
npm run lint:fix   # Auto-fix linting issues
```

### Infrastructure Development

```bash
cd source/infrastructure
npm run build      # Compile TypeScript
npm run test       # Run infrastructure tests
npm run cdk        # Run CDK commands
```

### Common Library Development

```bash
cd source/common
npm run build      # Compile TypeScript
npm run test       # Run tests
```

## Troubleshooting

### Node Version Issues

If you encounter errors related to Node.js version:
- Ensure you're using Node 22 or higher
- Use a version manager like `nvm` to switch versions

### Installation Failures

If `npm install` fails:
- Clear npm cache: `npm cache clean --force`
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again

### Build Errors

If `npm run build` fails:
- Check that all dependencies are installed
- Ensure you're in the repository root
- Try cleaning and rebuilding: `npm run clean && npm install && npm run build`

### Test Failures

If tests fail:
- Ensure all dependencies are installed
- Check that the build completed successfully
- Review test output for specific error messages

## Next Steps

Once your local environment is set up:

1. **Explore the codebase** - Review the architecture and code structure
2. **Make changes** - Modify code in any of the source packages
3. **Run tests** - Verify your changes with `npm test`
4. **Build** - Compile with `npm run build`
5. **Deploy** (when ready) - Configure `.env` with AWS details and deploy

## Additional Resources

- [Main README](./README.md) - Solution overview and deployment instructions
- [Architecture Diagram](./docs/diagrams/architecture/high-level.drawio.svg)
- [AWS Solutions Page](https://aws.amazon.com/solutions/implementations/innovation-sandbox-on-aws)
- [Implementation Guide](https://docs.aws.amazon.com/solutions/latest/innovation-sandbox-on-aws/)
