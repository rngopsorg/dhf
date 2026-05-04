# hippocampus-dag — DHF Memory Lattice (epoch-tagged DAG)
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/hippod ./cmd/hippod

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=build /out/hippod /app/hippod
EXPOSE 5001 8080 4001
ENTRYPOINT ["/app/hippod"]
