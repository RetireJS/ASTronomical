# GitHub Workflows

This directory contains GitHub Actions workflows for the ASTronomical project.

## Workflows

### build.yml
Runs on every push and pull request to validate the code:
- Linting
- Type checking
- Tests
- Build verification

### publish.yml
Publishes stable releases to npm with the `latest` tag.

**Trigger**: When a GitHub release is published (not a prerelease)

**What it does**:
1. Runs full CI (lint, build, test)
2. Publishes to npm with `--tag latest`
3. Includes npm provenance for supply chain security

**How to use**:
1. Update version in `package.json` (e.g., `2.1.0`)
2. Create a new GitHub release and mark it as a full release
3. Workflow automatically publishes to npm

### publish-prerelease.yml
Publishes prereleases to npm with the `next` tag.

**Trigger**: When a GitHub release is marked as a prerelease

**What it does**:
1. Runs full CI (lint, build, test)
2. Publishes to npm with `--tag next`
3. Includes npm provenance for supply chain security

**How to use**:
1. Update version in `package.json` with prerelease identifier (e.g., `2.1.0-beta.1`, `2.1.0-rc.1`)
2. Create a new GitHub release and check "This is a pre-release"
3. Workflow automatically publishes to npm with the `next` tag

**Installing prereleases**:
```bash
# Install the latest prerelease
npm install astronomical@next

# Install a specific prerelease version
npm install astronomical@2.1.0-beta.1
```

## Setup Requirements

Both publish workflows require an `NPM_TOKEN` secret to be configured in GitHub repository settings:

1. Generate an npm access token at https://www.npmjs.com/settings/tokens
   - Type: Automation token (for CI/CD)
   - Permissions: Publish
2. Add the token to GitHub:
   - Go to repository Settings → Secrets and variables → Actions
   - Create new repository secret named `NPM_TOKEN`
   - Paste your npm token

## Versioning Convention

- **Stable releases**: `X.Y.Z` (e.g., `2.0.1`, `2.1.0`)
  - Published to `latest` tag (default)
  - Use for production-ready releases

- **Prereleases**: `X.Y.Z-identifier.N` (e.g., `2.1.0-beta.1`, `2.1.0-rc.2`)
  - Published to `next` tag
  - Use for testing new features before stable release
  - Common identifiers: `alpha`, `beta`, `rc` (release candidate)

## Example Release Process

### For a stable release:
```bash
# 1. Update version
npm version patch  # or minor, major

# 2. Push changes
git push && git push --tags

# 3. Create GitHub release from the tag (uncheck "pre-release")
# 4. Workflow publishes to npm@latest
```

### For a prerelease:
```bash
# 1. Update version
npm version prerelease --preid=beta  # creates 2.0.1-beta.0
# or manually edit package.json

# 2. Commit and push
git add package.json
git commit -m "chore: bump version to 2.0.1-beta.0"
git push

# 3. Create GitHub release and CHECK "This is a pre-release"
# 4. Workflow publishes to npm@next
```

### Promoting a prerelease to stable:
```bash
# 1. Remove prerelease identifier
npm version 2.1.0  # removes -beta.1

# 2. Push and create stable release
git push && git push --tags

# 3. Create GitHub release (uncheck "pre-release")
# 4. Workflow publishes to npm@latest
```

## Security

Both workflows use:
- `provenance: true` for npm package provenance (links package to source code)
- `id-token: write` permission for OpenID Connect authentication
- `contents: read` minimal permissions
- Automation token stored securely in GitHub Secrets

## Troubleshooting

**Workflow doesn't trigger:**
- Ensure you created a GitHub Release, not just a git tag
- Check that the release type matches (prerelease vs full release)

**Publish fails with authentication error:**
- Verify `NPM_TOKEN` secret is set correctly
- Ensure token has publish permissions
- Check token hasn't expired

**Wrong npm tag:**
- Stable release published to `next`: Release was marked as prerelease
- Prerelease published to `latest`: Release was not marked as prerelease
