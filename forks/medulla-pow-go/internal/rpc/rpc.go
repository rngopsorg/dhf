// Package rpc implements the JSON-RPC 2.0 surface of medulla-pow.
package rpc

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/ecca-stack/medulla-pow/internal/chain"
)

type Server struct {
	C *chain.Chain
}

type req struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}
type errObj struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}
type resp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *errObj         `json:"error,omitempty"`
}

func parseHex32(s string) ([32]byte, error) {
	var out [32]byte
	if len(s) >= 2 && s[:2] == "0x" {
		s = s[2:]
	}
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		return out, fmt.Errorf("expected 32-byte hex, got %s", s)
	}
	copy(out[:], b)
	return out, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("/rpc", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var rq req
		if err := json.NewDecoder(r.Body).Decode(&rq); err != nil {
			writeErr(w, json.RawMessage(`null`), -32700, "parse error")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch rq.Method {
		case "getinfo":
			tip := s.C.Tip()
			tipHash := tip.Header.Hash()
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: map[string]any{
				"height":     s.C.Height(),
				"difficulty": s.C.Difficulty(),
				"epoch":      s.C.Epoch(),
				"tip":        hex.EncodeToString(tipHash[:]),
			}})
		case "getlatestanchor":
			b := s.C.Tip()
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: anchorOf(b)})
		case "getepochanchor":
			var p struct {
				Epoch uint32 `json:"epoch"`
			}
			_ = json.Unmarshal(rq.Params, &p)
			b, err := s.C.EpochAnchor(p.Epoch)
			if err != nil {
				writeErr(w, rq.ID, -32000, err.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: anchorOf(b)})
		case "submitcoherenceroot":
			var p struct {
				CrossRoot   string `json:"crossRoot"`
				EvmRoot     string `json:"evmRoot"`
				IpfsRoot    string `json:"ipfsRoot"`
				SleevesRoot string `json:"sleevesRoot"`
			}
			if err := json.Unmarshal(rq.Params, &p); err != nil {
				writeErr(w, rq.ID, -32602, err.Error())
				return
			}
			t := chain.CoherenceTuple{}
			for i, h := range []string{p.CrossRoot, p.EvmRoot, p.IpfsRoot, p.SleevesRoot} {
				v, err := parseHex32(h)
				if err != nil {
					writeErr(w, rq.ID, -32602, err.Error())
					return
				}
				switch i {
				case 0:
					t.CrossRoot = v
				case 1:
					t.EvmRoot = v
				case 2:
					t.IpfsRoot = v
				case 3:
					t.SleevesRoot = v
				}
			}
			b, err := s.C.SubmitCoherenceRoot(t)
			if err != nil {
				writeErr(w, rq.ID, -32000, err.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: anchorOf(b)})
		case "getsynapticproof":
			var p struct {
				BlockHash string `json:"blockHash"`
			}
			_ = json.Unmarshal(rq.Params, &p)
			root, peaks, count, err := s.C.SynapticProof(p.BlockHash)
			if err != nil {
				writeErr(w, rq.ID, -32000, err.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: map[string]any{
				"root": root, "peaks": peaks, "count": count,
			}})
		case "joinpool":
			var p struct {
				Pool     string `json:"pool"`
				SleeveID string `json:"sleeveId"`
			}
			_ = json.Unmarshal(rq.Params, &p)
			s.C.JoinPool(p.Pool, p.SleeveID)
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: map[string]any{"ok": true}})
		case "mineblock":
			// trigger a block on a synthetic empty coherence tuple (used by ops/manual mining)
			b, err := s.C.SubmitCoherenceRoot(chain.CoherenceTuple{})
			if err != nil {
				writeErr(w, rq.ID, -32000, err.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: rq.ID, Result: anchorOf(b)})
		default:
			writeErr(w, rq.ID, -32601, "method not found: "+rq.Method)
		}
	})
	return mux
}

func anchorOf(b chain.Block) map[string]any {
	hh := b.Header.Hash()
	return map[string]any{
		"blockHash":         hex.EncodeToString(hh[:]),
		"height":            0,
		"epoch":             b.Header.Epoch,
		"crossRoot":         hex.EncodeToString(b.Tuple.CrossRoot[:]),
		"evmRoot":           hex.EncodeToString(b.Tuple.EvmRoot[:]),
		"ipfsRoot":          hex.EncodeToString(b.Tuple.IpfsRoot[:]),
		"sleevesRoot":       hex.EncodeToString(b.Tuple.SleevesRoot[:]),
		"synapticFieldRoot": hex.EncodeToString(b.Header.SynapticFieldRoot[:]),
		"ts":                b.Header.Timestamp,
		"difficulty":        b.Header.Difficulty,
	}
}

func writeErr(w http.ResponseWriter, id json.RawMessage, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp{JSONRPC: "2.0", ID: id, Error: &errObj{Code: code, Message: msg}})
}
