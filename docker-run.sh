#!/bin/sh
cd /data/ || exit 1
if [ ! -f "config.yaml" ]; then
	echo "No config found"
	exit 1
fi
node /opt/uia-proxy/src/index.js
