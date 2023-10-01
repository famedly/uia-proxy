#!/bin/bash
set -e

# Define some generic names
IMAGE_NAME=local/uia-proxy      # Ensure that the name of our locally built image will never clash with productive images
CONTAINER_NAME=test-uia-proxy   # Some meaningfull container name, which we can use for debugging


# Display info
docker image ls $IMAGE_NAME
echo
docker container ls -a
echo
read -r -p "About to remove docker container and image. Are you sure ? [y/N] " response
case "$response" in
    [yY][eE][sS]|[yY]) 
        # Get rid of all the docker stuf
        docker stop $CONTAINER_NAME 2>/dev/null || :
        docker container rm -f $CONTAINER_NAME 2>/dev/null || :
        docker image rm -f $IMAGE_NAME 2>/dev/null || :
        ;;
    *)
        echo "Nothing deleted."
        ;;
esac

read -r -p "About to remove ./data along with all logs and configs. Are you sure ? [y/N] " response
case "$response" in
    [yY][eE][sS]|[yY]) 
        # Remove temporary data
        rm -rf ./data
        ;;
    *)
        echo "Nothing deleted."
        ;;
esac

read -r -p "About to remove 'config.yaml'. Are you sure ? [y/N] " response
case "$response" in
    [yY][eE][sS]|[yY]) 
        # Remove temporary data 
        rm -f config.yaml
        ;;
    *)
        echo "Nothing deleted."
        ;;
esac

read -r -p "About to remove 'build' and 'node_modules'. Are you sure ? [y/N] " response
case "$response" in
    [yY][eE][sS]|[yY]) 
        # Remove temporary data 
        rm -rf build
        rm -rf node_modules
        ;;
    *)
        echo "Nothing deleted."
        ;;
esac