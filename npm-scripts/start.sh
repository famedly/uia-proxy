#!/bin/bash
set -e

# Build everything
npm run-script build

# Ensure expected path exists
mkdir -p ./data/logs 

# Make a copy of the sample config (-n Do not overwrite an existing file),
# while draining possible non zero exit code.
# NOTE: For the standalone run we need this copy in the same directory!
#       As a nice sideffect, it will never overwrite the config used in container.
cp -n config.sample.yaml config.yaml 2>/dev/null || :

# We need to know on which OS we are, so we can use appropriative sed flavor ;)
# NOTE: On macOS you may need to 'brew install gnu-sed' which will give you 'gsed', 
#       while on the most of the Linux distros 'sed' should be already there.
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        SEDCMD="sed"
elif [[ "$OSTYPE" == "darwin"* ]]; then
        SEDCMD="gsed"
else
        # Unknown.
        echo "Unsupported OS"
        exit 38 # 'function not implemented'
fi

# Since we are intended to run standalone at host, we have to adjust both log and usernamemap paths
# to be host-local (not container-local)
$SEDCMD -i 's@\"/data/logs\"@\"./data/logs\"@g' config.yaml
$SEDCMD -i 's@\"/data/usernamemap\"@\"./data/usernamemap\"@g' config.yaml

# Let node bootstrap our service
node ./build/src/index.js