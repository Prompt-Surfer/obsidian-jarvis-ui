#!/usr/bin/env bash
# bump-version.sh — Auto-tag based on conventional commits since last tag
# Usage: bash tracking/bump-version.sh [--dry-run]
#
# Rules (SemVer):
#   feat:  → bump MINOR (v1.X.0)
#   fix:   → bump PATCH (v1.0.X)
#   chore:/docs:/refactor: → bump PATCH
#   BREAKING CHANGE or feat!: → bump MAJOR (X.0.0)

set -e

DRY_RUN=false
[[ "${1}" == "--dry-run" ]] && DRY_RUN=true

# Get latest tag (default to v0.0.0 if none)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
CURRENT_COMMIT=$(git rev-parse HEAD)
TAG_COMMIT=$(git rev-list -n1 "$LAST_TAG" 2>/dev/null || echo "")

if [[ "$TAG_COMMIT" == "$CURRENT_COMMIT" ]]; then
  echo "Already tagged at $LAST_TAG — nothing to bump."
  exit 0
fi

echo "Last tag:    $LAST_TAG"
echo "New commits since tag:"
git log "${LAST_TAG}..HEAD" --oneline
echo ""

# Parse version numbers
VERSION="${LAST_TAG#v}"
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f2)
PATCH=$(echo "$VERSION" | cut -d. -f3)

# Determine bump type from commits since last tag
BUMP="none"
while IFS= read -r line; do
  if echo "$line" | grep -qiE "BREAKING CHANGE|feat!:"; then
    BUMP="major"; break
  elif echo "$line" | grep -qiE "^feat(\(|:)"; then
    [[ "$BUMP" != "major" ]] && BUMP="minor"
  elif echo "$line" | grep -qiE "^(fix|chore|docs|refactor|style|test|perf)(\(|:)"; then
    [[ "$BUMP" == "none" ]] && BUMP="patch"
  fi
done < <(git log "${LAST_TAG}..HEAD" --pretty=format:"%s")

if [[ "$BUMP" == "none" ]]; then
  echo "No conventional commits found — no version bump needed."
  exit 0
fi

# Calculate new version
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_TAG="v${MAJOR}.${MINOR}.${PATCH}"
echo "Bump type:   $BUMP"
echo "New version: $NEW_TAG"

if $DRY_RUN; then
  echo "[DRY RUN] Would tag: $NEW_TAG"
  exit 0
fi

# Generate tag message from commits
TAG_MSG=$(git log "${LAST_TAG}..HEAD" --pretty=format:"- %s" | head -20)
git tag -a "$NEW_TAG" -m "${NEW_TAG}

Changes since ${LAST_TAG}:
${TAG_MSG}"

echo ""
echo "✅ Tagged $NEW_TAG"
echo "Push with: git push origin $NEW_TAG"
