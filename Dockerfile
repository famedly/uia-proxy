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
        nodejs=18.19.0+dfsg-6~deb12u1 \
        tzdata  && \
# clean up...
        rm -rf /var/lib/apt/lists/* && \
# ensure the UTC timezone is set
ln -fs /usr/share/zoneinfo/Etc/UTC /etc/localtime

COPY --from=builder /src/build/src /opt/uia-proxy/src
COPY --from=builder /src/build/utils /opt/uia-proxy/utils
COPY --from=builder /src/node_modules /opt/uia-proxy/node_modules
COPY docker-run.sh /docker-run.sh
VOLUME ["/data"]
ENTRYPOINT ["/docker-run.sh"]
HEALTHCHECK --interval=10s --timeout=1s --start-period=5s --retries=3 \
 CMD curl -s http://localhost:9740/health || exit 1

ENV TZ=Etc/UTC