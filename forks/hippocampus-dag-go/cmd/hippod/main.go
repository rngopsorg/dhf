package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/ecca-stack/hippocampus-dag/internal/dag"
)

func main() {
	d := dag.New()
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("/dag/put", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var body struct {
			StackID    string      `json:"stackId"`
			Epoch      uint64      `json:"epoch"`
			Ciphertext dag.Cipher  `json:"ciphertext"`
			Links      []string    `json:"links"`
			Kind       string      `json:"kind"`
			Pinned     bool        `json:"pinned"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		n := &dag.Node{
			Ciphertext: body.Ciphertext, Links: body.Links, Epoch: body.Epoch,
			Kind: body.Kind, Pinned: body.Pinned, StackID: body.StackID,
		}
		cid := d.Put(n)
		_ = json.NewEncoder(w).Encode(map[string]string{"cid": cid})
	})

	mux.HandleFunc("/dag/get", func(w http.ResponseWriter, r *http.Request) {
		cid := r.URL.Query().Get("cid")
		n, ok := d.Get(cid)
		if !ok {
			http.Error(w, "not found", 404)
			return
		}
		_ = json.NewEncoder(w).Encode(n)
	})

	mux.HandleFunc("/pin/add", func(w http.ResponseWriter, r *http.Request) {
		cid := r.URL.Query().Get("cid")
		if err := d.Pin(cid); err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})

	mux.HandleFunc("/dhf/recall", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var req dag.RecallReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		_ = json.NewEncoder(w).Encode(d.Recall(req))
	})

	mux.HandleFunc("/stat", func(w http.ResponseWriter, r *http.Request) {
		n, p, pr := d.Stat()
		_ = json.NewEncoder(w).Encode(map[string]int{"nodes": n, "pinned": p, "peers": pr})
	})

	addr := ":5001"
	log.Printf("[hippocampus-dag] listening %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
