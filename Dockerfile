FROM docker.io/node:alpine as builder

RUN apk add --no-cache git make gcc g++ python linux-headers
COPY . /src
WORKDIR /src
RUN yarn --network-timeout=100000 install \
	&& yarn run build

FROM docker.io/alpine
RUN apk add --no-cache ca-certificates nodejs
COPY --from=builder /src/build /opt/famedly-login-service
COPY --from=builder /src/node_modules /opt/famedly-login-service/node_modules
COPY docker-run.sh /docker-run.sh
VOLUME ["/data"]
ENTRYPOINT ["/docker-run.sh"]
