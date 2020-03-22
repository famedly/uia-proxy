#!/bin/sh
cd /data/
if [ ! -f "config.yaml" ]; then
	echo "No config found"
	exit 1
fi
node /opt/famedly-login-service/src/index.js
