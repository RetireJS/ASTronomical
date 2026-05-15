# Changelog

## [3.0.5] - 2026-05-15

- Upgrade meriyah to 7.x (`sourceType` replaces `module: boolean`)
- Disable regex validation (`validateRegex: false`) during parsing

## [3.0.4] - 2026-05-15

- Add JSX parsing support by falling back to meriyah's `jsx` option when non-JSX parsing fails (tries both module and script modes)

## [3.0.3] - 2026-03-07

- Fix problem with resolving TemplateElement values in filters

## [3.0.2] - 2026-03-07

- Fix problem with resolving TemplateElement values in filters

## [3.0.1] - 2026-03-07

- Fix problem with resolving TemplateElement values
- Update dependencies and fix related stuff

## [3.0.0] - 2026-01-18

- Fix broken CJS/ESM dual build

## [2.1.1-rc.0] - 2025-10-14

### Performance upgrades

- Reduce memory/GC

## [2.0.1] - 2025-06-04

### Performance upgrades

- Reduce memory

## [2.0.0] - 2025-06-02

### Performance upgrades

- Don't includeranges and loc by default - reduced memory usage

## [1.0.0-beta.16] - 2024-03-08

### Bugfix

- Fixing binding issues for hoisting

## [1.0.0-beta.15] - 2024-02-24

### Fixing

- Fix scope creation bug and reduce nodePath creation

## [1.0.0-beta.14] - 2024-02-24

### Refactoring

- Remove globals leakage from scopes++

## [1.0.0-beta.13] - 2024-02-20

### Performance

- Reducing memory consumption

## [1.0.0-beta.12] - 2024-02-14

### Performance

- Replacing babel with meriyah

## [1.0.0-beta.12] - 2024-02-14

### Performance

- Replacing babel with meriyah

## [1.0.0-beta.10] - 2024-02-15

### Bugfix

- More speed and memory improvements

## [1.0.0-beta.9] - 2024-02-14

### Bugfix

- More scoping issues for binding

## [1.0.0-beta.8] - 2024-02-14

### Bugfix

- Scoping issues for binding

## [1.0.0-beta.7] - 2024-02-06

### Changed

- Speed improvement - switch out babel.traverse with optimized traversal

## [1.0.0-beta.6] - 2024-02-06

### Added

- Support for function `/fn:join(data, sep)`, `/fn:first(data)`, `/fn:concat(...)` and `/fn:nthchild(selector, n)`

## [1.0.0-beta.5] - 2024-02-06

### Changes

- Modernizing build output

## [1.0.0-beta.4] - 2024-02-06

### Bugfix

- Fix bug in resolve `$$`

## [1.0.0-beta.3] - 2024-02-06

### Added

- Support for `$$` which will resolve to the right value for x in both `a.x = 2` and `let y = 1; a.x = y;`

## [1.0.0-beta.2] - 2024-02-05

### Fixes

- Performance update

## [1.0.0-beta.1] - 2024-02-01

Fixing build

## [1.0.0-beta.0] - 2024-02-01

Initial version
