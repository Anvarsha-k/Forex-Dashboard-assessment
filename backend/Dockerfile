FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

FROM alpine:3.22
# CA certificates are needed for the wss:// connection to Tiingo.
RUN apk add --no-cache ca-certificates
COPY --from=build /server /server
USER nobody
EXPOSE 8080
ENTRYPOINT ["/server"]
