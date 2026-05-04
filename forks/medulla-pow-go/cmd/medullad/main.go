package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/ecca-stack/medulla-pow/internal/chain"
	rpcsrv "github.com/ecca-stack/medulla-pow/internal/rpc"
)

func main() {
	diffStr := os.Getenv("ECCA_DIFFICULTY")
	diff := uint32(4)
	if diffStr != "" {
		if n, err := strconv.Atoi(diffStr); err == nil {
			diff = uint32(n)
		}
	}
	c := chain.NewChain(diff)
	s := &rpcsrv.Server{C: c}

	addr := ":8332"
	log.Printf("[medulla-pow] genesis tip mined; difficulty=%d listening=%s", c.Difficulty(), addr)
	if err := http.ListenAndServe(addr, s.Handler()); err != nil {
		log.Fatal(err)
	}
}
