// Package dag implements the in-process DHF Memory Lattice. Persistence to
// MinIO is layered on top in cmd/hippod/main.go (not required for the
// research simulation; volume mount serves as durable backstore).
package dag

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
)

type Cipher struct {
	IV string `json:"iv"`
	CT string `json:"ct"`
	V  int    `json:"v"`
}

type Node struct {
	CID        string   `json:"cid"`
	Ciphertext Cipher   `json:"ciphertext"`
	Links      []string `json:"links"`
	Epoch      uint64   `json:"epoch"`
	Kind       string   `json:"kind"`
	Pinned     bool     `json:"pinned"`
	StackID    string   `json:"stackId"`
}

type DAG struct {
	mu    sync.RWMutex
	nodes map[string]*Node
	// Secondary indices for O(log n) epoch-window scans:
	byEpoch   map[uint64][]string                 // epoch → CIDs
	byStack   map[string][]string                 // stackId → CIDs
	byKind    map[string][]string                 // kind → CIDs
	pinned    map[string]struct{}
	peers     map[string]map[string]struct{}      // peerId → set of CIDs replicated
}

func New() *DAG {
	return &DAG{
		nodes:   map[string]*Node{},
		byEpoch: map[uint64][]string{},
		byStack: map[string][]string{},
		byKind:  map[string][]string{},
		pinned:  map[string]struct{}{},
		peers:   map[string]map[string]struct{}{},
	}
}

func (d *DAG) cid(stackID string, epoch uint64, ciphertext Cipher, links []string, kind string) string {
	// content addressing — sha256 over stable JSON of the canonical fields
	type canon struct {
		Stack string   `json:"stack"`
		Epoch uint64   `json:"epoch"`
		CT    Cipher   `json:"ct"`
		Links []string `json:"links"`
		Kind  string   `json:"kind"`
	}
	b, _ := json.Marshal(canon{stackID, epoch, ciphertext, append([]string{}, links...), kind})
	h := sha256.Sum256(b)
	return fmt.Sprintf("ecca://%s@%d", hex.EncodeToString(h[:]), epoch)
}

func (d *DAG) Put(n *Node) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if n.CID == "" {
		n.CID = d.cid(n.StackID, n.Epoch, n.Ciphertext, n.Links, n.Kind)
	}
	if _, exists := d.nodes[n.CID]; exists {
		return n.CID
	}
	d.nodes[n.CID] = n
	d.byEpoch[n.Epoch] = append(d.byEpoch[n.Epoch], n.CID)
	d.byStack[n.StackID] = append(d.byStack[n.StackID], n.CID)
	d.byKind[n.Kind] = append(d.byKind[n.Kind], n.CID)
	if n.Pinned {
		d.pinned[n.CID] = struct{}{}
	}
	return n.CID
}

func (d *DAG) Get(cid string) (*Node, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	n, ok := d.nodes[cid]
	return n, ok
}

func (d *DAG) Pin(cid string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	n, ok := d.nodes[cid]
	if !ok {
		return errors.New("not found")
	}
	n.Pinned = true
	d.pinned[cid] = struct{}{}
	return nil
}

// Recall walks the DAG under (epoch, memoryToken) gates.
//   - epochAlignment: |caller.epoch - node.epoch| <= 2 OR node.Pinned
//   - depthAuthorization: memoryToken >= depth_from_root
type RecallReq struct {
	RootCID     string `json:"rootCid"`
	StackID     string `json:"stackId"`
	Epoch       uint64 `json:"epoch"`
	Depth       int    `json:"depth"`
	MemoryToken int    `json:"memoryToken"`
}
type RecallResp struct {
	Fragments []*Node  `json:"fragments"`
	Broken    []string `json:"broken"`
	Fidelity  float64  `json:"fidelity"`
}

func (d *DAG) Recall(r RecallReq) RecallResp {
	d.mu.RLock()
	defer d.mu.RUnlock()
	visited := map[string]struct{}{}
	out := RecallResp{}
	var walk func(cid string, dleft int)
	walk = func(cid string, dleft int) {
		if dleft < 0 {
			return
		}
		if _, ok := visited[cid]; ok {
			return
		}
		visited[cid] = struct{}{}
		n, ok := d.nodes[cid]
		if !ok {
			out.Broken = append(out.Broken, cid)
			return
		}
		if n.StackID != r.StackID {
			out.Broken = append(out.Broken, cid+"#stack_mismatch")
			return
		}
		used := r.Depth - dleft
		if r.MemoryToken < used {
			out.Broken = append(out.Broken, cid+"#insufficient_memory_token")
			return
		}
		drift := int64(r.Epoch) - int64(n.Epoch)
		if drift < 0 {
			drift = -drift
		}
		if drift > 2 && !n.Pinned {
			out.Broken = append(out.Broken, fmt.Sprintf("%s#epoch_drift_%d", cid, drift))
			return
		}
		out.Fragments = append(out.Fragments, n)
		for _, l := range n.Links {
			walk(l, dleft-1)
		}
	}
	walk(r.RootCID, r.Depth)

	total := len(out.Fragments) + len(out.Broken)
	if total == 0 {
		out.Fidelity = 1
	} else {
		out.Fidelity = float64(len(out.Fragments)) / float64(total)
	}
	return out
}

// EpochScan performs an O(log n) range query over a window [from, to].
func (d *DAG) EpochScan(from, to uint64) []*Node {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var keys []uint64
	for e := range d.byEpoch {
		if e >= from && e <= to {
			keys = append(keys, e)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	var out []*Node
	for _, e := range keys {
		for _, cid := range d.byEpoch[e] {
			if n, ok := d.nodes[cid]; ok {
				out = append(out, n)
			}
		}
	}
	return out
}

func (d *DAG) Stat() (nodes, pinned, peers int) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.nodes), len(d.pinned), len(d.peers)
}
