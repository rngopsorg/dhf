# medulla-pow — Cortical Anchor Chain (PoW + Synaptic Field MMR)
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/medullad ./cmd/medullad

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=build /out/medullad /app/medullad
EXPOSE 8332 8333
ENTRYPOINT ["/app/medullad"]
