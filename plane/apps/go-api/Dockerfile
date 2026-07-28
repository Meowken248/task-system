FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/plane-go-api ./cmd/api

FROM alpine:3.21
RUN addgroup -S plane && adduser -S plane -G plane
COPY --from=builder /out/plane-go-api /usr/local/bin/plane-go-api
USER plane
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/plane-go-api"]
