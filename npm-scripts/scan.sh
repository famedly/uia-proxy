#!/bin/bash
set -e

# Build everything
npm run-script build

# Run linter
npm run-script lint

# Run npm audit
npm audit

echo
read -r -p "About to run 'docker scout quickview' (You have to be logged into a 'docker.io' account). Continue ? [y/N] " response
case "$response" in
    [yY][eE][sS]|[yY]) 
        # Try to login first
        docker login
        docker scout quickview
        ;;
    *)
        echo "Skipped 'docker scout'."
        ;;
esac