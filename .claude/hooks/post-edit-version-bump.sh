#!/bin/bash
# Auto-increment version in manifest.json after code changes

# Read the tool arguments JSON from stdin
TOOL_ARGS=$(cat)

# Extract file_path from the JSON
FILE_PATH=$(echo "$TOOL_ARGS" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

# If no file path found, exit
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only run if manifest.json wasn't the file being edited
if [[ "$FILE_PATH" == *"manifest.json"* ]]; then
  exit 0
fi

# Only run for TypeScript, JavaScript, and CSS files
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.js && "$FILE_PATH" != *.css && "$FILE_PATH" != *.mjs ]]; then
  exit 0
fi

MANIFEST_FILE="manifest.json"

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "manifest.json not found"
  exit 1
fi

# Read current version
CURRENT_VERSION=$(grep -o '"version": "[^"]*"' "$MANIFEST_FILE" | cut -d'"' -f4)

if [[ -z "$CURRENT_VERSION" ]]; then
  echo "Could not find version in manifest.json"
  exit 1
fi

# Parse version components
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

# Increment patch version
PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Update manifest.json
sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$MANIFEST_FILE"
rm -f "$MANIFEST_FILE.bak"

echo "Version bumped: $CURRENT_VERSION → $NEW_VERSION"
