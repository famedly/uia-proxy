#!/bin/bash
set -e

# Define some generic names
IMAGE_NAME=local/uia-proxy      # Ensure that the name of our locally built image will never clash with productive images
HOST_NAME=test-uia-proxy        # Container's internal hostname
CONTAINER_NAME=test-uia-proxy   # Some meaningfull container name, which we can use for debugging

# Build everything
npm run-script build

# Let docker build an image
docker build -t $IMAGE_NAME .
# Display scout report
docker scout quickview

# Ensure expected path exists
mkdir -p ./data/logs 

# Make a copy of the sample config (-n Do not overwrite an existing file),
# while draining possible non zero exit code
cp -n config.sample.yaml ./data/config.yaml 2>/dev/null || :

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

# We are intended to run service in a standalone container, so we have 
# to let the webserver bind to all container's interfaces (0.0.0.0 instead of localhost)
$SEDCMD -i "s@host: localhost@host: $HOST_NAME@g" ./data/config.yaml

# Let docker run our image in detached (-d) self-cleaning (--rm) container
docker run -d --rm \
        --name $CONTAINER_NAME \
        --hostname $HOST_NAME \
        -v ./data:/data \
        -p 9740:9740 \
        $IMAGE_NAME

# We're done, so just display few usefull commands
echo
echo "======================= Container is now up and running ================"
echo 
echo "          Access server:  telnet localhost 9740"
echo "                     or:  curl localhost:9740"
echo
echo "              View logs:  less +F ./data/logs/uia-proxy-$(date '+%Y-%m-%d').log"
echo "       Login into shell:  docker exec -it $CONTAINER_NAME sh"
echo "         Stop container:  docker stop $CONTAINER_NAME"
echo "  Remove image manually:  docker image -rm $IMAGE_NAME"
echo
echo "========================================================================"