FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY bin/license-server /app/license-server

EXPOSE 8444
VOLUME ["/data"]

ENV DB_PATH=/data/licenses.json
ENV PORT=8444

CMD ["/app/license-server"]
