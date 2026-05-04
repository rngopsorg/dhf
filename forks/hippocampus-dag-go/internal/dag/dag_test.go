package dag

import (
	"testing"
)

func TestPutAndGet(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aabbcc", CT: "encrypted", V: 1},
		Links:      []string{},
		Epoch:      1,
		Kind:       "episodic",
		Pinned:     false,
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)
	if cid == "" {
		t.Fatal("expected non-empty CID")
	}
	got, ok := d.Get(cid)
	if !ok {
		t.Fatal("expected to find node")
	}
	if got.StackID != "stack:human:1:abc" {
		t.Fatal("stackId mismatch")
	}
	if got.Epoch != 1 {
		t.Fatal("epoch mismatch")
	}
}

func TestPutIdempotent(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "bb", V: 1},
		Links:      []string{},
		Epoch:      0,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid1 := d.Put(n)
	// Create an identical node
	n2 := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "bb", V: 1},
		Links:      []string{},
		Epoch:      0,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid2 := d.Put(n2)
	if cid1 != cid2 {
		t.Fatal("same content should produce same CID")
	}
	nodes, _, _ := d.Stat()
	if nodes != 1 {
		t.Fatalf("expected 1 node, got %d", nodes)
	}
}

func TestPin(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "bb", V: 1},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)
	err := d.Pin(cid)
	if err != nil {
		t.Fatalf("pin failed: %v", err)
	}
	got, _ := d.Get(cid)
	if !got.Pinned {
		t.Fatal("node should be pinned")
	}
	_, pinned, _ := d.Stat()
	if pinned != 1 {
		t.Fatalf("expected 1 pinned, got %d", pinned)
	}
}

func TestPinNotFound(t *testing.T) {
	d := New()
	err := d.Pin("ecca://nonexistent@0")
	if err == nil {
		t.Fatal("expected error for non-existent CID")
	}
}

func TestRecallBasic(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "hello", V: 1},
		Links:      []string{},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)

	resp := d.Recall(RecallReq{
		RootCID:     cid,
		StackID:     "stack:human:1:abc",
		Epoch:       1,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 1 {
		t.Fatalf("expected 1 fragment, got %d", len(resp.Fragments))
	}
	if resp.Fidelity != 1.0 {
		t.Fatalf("expected fidelity 1.0, got %f", resp.Fidelity)
	}
}

func TestRecallWithLinks(t *testing.T) {
	d := New()
	leaf := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "leaf", V: 1},
		Links:      []string{},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	leafCid := d.Put(leaf)

	root := &Node{
		Ciphertext: Cipher{IV: "bb", CT: "root", V: 1},
		Links:      []string{leafCid},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	rootCid := d.Put(root)

	resp := d.Recall(RecallReq{
		RootCID:     rootCid,
		StackID:     "stack:human:1:abc",
		Epoch:       1,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 2 {
		t.Fatalf("expected 2 fragments, got %d", len(resp.Fragments))
	}
	if resp.Fidelity != 1.0 {
		t.Fatalf("expected fidelity 1.0, got %f", resp.Fidelity)
	}
}

func TestRecallEpochGate(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "old", V: 1},
		Links:      []string{},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)

	// Recall from epoch 10 — drift > 2, should be broken
	resp := d.Recall(RecallReq{
		RootCID:     cid,
		StackID:     "stack:human:1:abc",
		Epoch:       10,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Broken) != 1 {
		t.Fatalf("expected 1 broken, got %d", len(resp.Broken))
	}
	if resp.Fidelity != 0.0 {
		t.Fatalf("expected fidelity 0.0, got %f", resp.Fidelity)
	}
}

func TestRecallPinnedBypassesEpochGate(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "pinned", V: 1},
		Links:      []string{},
		Epoch:      1,
		Kind:       "episodic",
		Pinned:     true,
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)

	// Even with epoch drift > 2, pinned nodes are accessible
	resp := d.Recall(RecallReq{
		RootCID:     cid,
		StackID:     "stack:human:1:abc",
		Epoch:       100,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 1 {
		t.Fatalf("expected 1 fragment (pinned bypasses epoch gate), got %d", len(resp.Fragments))
	}
}

func TestRecallStackMismatch(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "data", V: 1},
		Links:      []string{},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)

	resp := d.Recall(RecallReq{
		RootCID:     cid,
		StackID:     "stack:human:2:other",
		Epoch:       1,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Broken) != 1 {
		t.Fatalf("expected 1 broken (stack mismatch), got %d", len(resp.Broken))
	}
}

func TestRecallDepthLimit(t *testing.T) {
	d := New()
	// Chain: n3 -> n2 -> n1 -> n0
	var prevCid string
	for i := 0; i < 4; i++ {
		links := []string{}
		if prevCid != "" {
			links = []string{prevCid}
		}
		n := &Node{
			Ciphertext: Cipher{IV: "aa", CT: string(rune('a' + i)), V: 1},
			Links:      links,
			Epoch:      1,
			Kind:       "episodic",
			StackID:    "stack:human:1:abc",
		}
		prevCid = d.Put(n)
	}

	// Recall with depth=2 should only get 3 nodes (root + 2 links deep)
	resp := d.Recall(RecallReq{
		RootCID:     prevCid,
		StackID:     "stack:human:1:abc",
		Epoch:       1,
		Depth:       2,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 3 {
		t.Fatalf("expected 3 fragments with depth=2, got %d", len(resp.Fragments))
	}
}

func TestEpochScan(t *testing.T) {
	d := New()
	for i := uint64(0); i < 5; i++ {
		d.Put(&Node{
			Ciphertext: Cipher{IV: "aa", CT: string(rune('a' + i)), V: 1},
			Epoch:      i,
			Kind:       "episodic",
			StackID:    "stack:human:1:abc",
		})
	}
	nodes := d.EpochScan(1, 3)
	if len(nodes) != 3 {
		t.Fatalf("expected 3 nodes in epoch range [1,3], got %d", len(nodes))
	}
}

func TestStat(t *testing.T) {
	d := New()
	d.Put(&Node{
		Ciphertext: Cipher{IV: "a", CT: "b", V: 1},
		Epoch:      0, Kind: "episodic", StackID: "s1", Pinned: true,
	})
	d.Put(&Node{
		Ciphertext: Cipher{IV: "c", CT: "d", V: 1},
		Epoch:      0, Kind: "episodic", StackID: "s1",
	})
	nodes, pinned, peers := d.Stat()
	if nodes != 2 {
		t.Fatalf("expected 2 nodes, got %d", nodes)
	}
	if pinned != 1 {
		t.Fatalf("expected 1 pinned, got %d", pinned)
	}
	if peers != 0 {
		t.Fatalf("expected 0 peers, got %d", peers)
	}
}
