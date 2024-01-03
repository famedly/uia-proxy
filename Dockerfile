FROM docker.io/node:bookworm as builder

# RUN apk add --no-cache git make gcc g++ python3 linux-headers
# FIXME: temporary workaround for https://gitlab.com/famedly/infra/collections/internal/-/issues/10
# RUN git config --global http.sslVerify false
RUN apt-get update -qq -o Acquire::Languages=none && \
    env DEBIAN_FRONTEND=noninteractive apt-get install \
    -yqq --no-install-recommends \
        git \
        make \
        gcc \
        g++

RUN mkdir /src
COPY package.json /src
COPY package-lock.json /src
WORKDIR /src
RUN npm install
COPY . /src
RUN npm run build

FROM docker.io/debian:bookworm-slim
# RUN apk add --no-cache ca-certificates nodejs
RUN apt-get update -qq -o Acquire::Languages=none && \
    apt-get upgrade -qq -o Acquire::Languages=none && \
    env DEBIAN_FRONTEND=noninteractive apt-get install \
    -yqq \
# install...
        ca-certificates \
        curl \
        dnsutils \
        nodejs=18.13.0+dfsg1-1 && \
# cleanup...
        apt-get autoclean && \
        apt-get autoremove

COPY --from=builder /src/build/src /opt/uia-proxy/src
COPY --from=builder /src/build/utils /opt/uia-proxy/utils
COPY --from=builder /src/node_modules /opt/uia-proxy/node_modules
COPY docker-run.sh /docker-run.sh
VOLUME ["/data"]
ENTRYPOINT ["/docker-run.sh"]
