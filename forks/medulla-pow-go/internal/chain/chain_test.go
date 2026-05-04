package chain

import (
	"testing"
)

func TestNewChain(t *testing.T) {
	c := NewChain(1) // low difficulty for fast tests
	if c.Height() != 0 {
		t.Fatalf("expected height 0, got %d", c.Height())
	}
	if c.Epoch() != 0 {
		t.Fatalf("expected epoch 0, got %d", c.Epoch())
	}
	if c.Difficulty() != 1 {
		t.Fatalf("expected difficulty 1, got %d", c.Difficulty())
	}
}

func TestGenesisBlock(t *testing.T) {
	c := NewChain(1)
	tip := c.Tip()
	if tip.Header.Epoch != 0 {
		t.Fatal("genesis should be epoch 0")
	}
	if tip.Header.Timestamp == 0 {
		t.Fatal("genesis timestamp should be non-zero")
	}
}

func TestSubmitCoherenceRoot(t *testing.T) {
	c := NewChain(1)
	tuple := CoherenceTuple{}
	copy(tuple.CrossRoot[:], []byte("crossroot00000000000000000000000"))
	copy(tuple.EvmRoot[:], []byte("evmroot000000000000000000000000x"))
	copy(tuple.IpfsRoot[:], []byte("ipfsroot0000000000000000000000xx"))
	copy(tuple.SleevesRoot[:], []byte("sleevesroot000000000000000000xxx"))

	blk, err := c.SubmitCoherenceRoot(tuple)
	if err != nil {
		t.Fatalf("SubmitCoherenceRoot failed: %v", err)
	}
	if blk.Header.Epoch != 1 {
		t.Fatalf("expected epoch 1, got %d", blk.Header.Epoch)
	}
	if c.Height() != 1 {
		t.Fatalf("expected height 1, got %d", c.Height())
	}
	if c.Epoch() != 1 {
		t.Fatalf("expected epoch 1, got %d", c.Epoch())
	}
}

func TestMultipleSubmits(t *testing.T) {
	c := NewChain(1)
	for i := 0; i < 5; i++ {
		tuple := CoherenceTuple{}
		tuple.CrossRoot[0] = byte(i)
		_, err := c.SubmitCoherenceRoot(tuple)
		if err != nil {
			t.Fatalf("submit %d failed: %v", i, err)
		}
	}
	if c.Epoch() != 5 {
		t.Fatalf("expected epoch 5, got %d", c.Epoch())
	}
	if c.Height() != 5 {
		t.Fatalf("expected height 5, got %d", c.Height())
	}
}

func TestEpochAnchor(t *testing.T) {
	c := NewChain(1)
	tuple := CoherenceTuple{}
	tuple.CrossRoot[0] = 0xAB
	c.SubmitCoherenceRoot(tuple)

	blk, err := c.EpochAnchor(1)
	if err != nil {
		t.Fatalf("EpochAnchor failed: %v", err)
	}
	if blk.Header.Epoch != 1 {
		t.Fatal("anchor epoch mismatch")
	}
}

func TestEpochAnchorNotFound(t *testing.T) {
	c := NewChain(1)
	_, err := c.EpochAnchor(99)
	if err == nil {
		t.Fatal("expected error for non-existent epoch")
	}
}

func TestJoinPool(t *testing.T) {
	c := NewChain(1)
	c.JoinPool("main", "sleeve1")
	c.JoinPool("main", "sleeve2")
	// No panic = success; pools are internal
}

func TestSubscribe(t *testing.T) {
	c := NewChain(1)
	ch := c.Subscribe()
	tuple := CoherenceTuple{}
	go func() {
		c.SubmitCoherenceRoot(tuple)
	}()
	blk := <-ch
	if blk.Header.Epoch != 1 {
		t.Fatal("subscriber should receive block")
	}
}
