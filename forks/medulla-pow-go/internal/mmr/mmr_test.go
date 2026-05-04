package mmr

import (
	"crypto/sha256"
	"testing"
)

func TestNewMMR(t *testing.T) {
	m := New(256)
	if m.Count() != 0 {
		t.Fatalf("expected count 0, got %d", m.Count())
	}
	root := m.RootHex()
	if root == "" {
		t.Fatal("expected non-empty root hex for empty MMR")
	}
}

func TestAppendSingle(t *testing.T) {
	m := New(0)
	var cr [32]byte
	copy(cr[:], []byte("hello world coherence root here!"))
	root := m.Append(cr)
	if m.Count() != 1 {
		t.Fatalf("expected count 1, got %d", m.Count())
	}
	if root == ([32]byte{}) {
		t.Fatal("root should not be zero after append")
	}
}

func TestAppendMultiple(t *testing.T) {
	m := New(0)
	roots := make([][32]byte, 0, 8)
	for i := 0; i < 8; i++ {
		var cr [32]byte
		cr[0] = byte(i)
		root := m.Append(cr)
		roots = append(roots, root)
	}
	if m.Count() != 8 {
		t.Fatalf("expected count 8, got %d", m.Count())
	}
	// After 8 leaves (power of 2), should have exactly 1 peak
	if len(m.peaks) != 1 {
		t.Fatalf("expected 1 peak after 8 leaves, got %d", len(m.peaks))
	}
}

func TestRootDeterministic(t *testing.T) {
	m1 := New(0)
	m2 := New(0)
	for i := 0; i < 5; i++ {
		var cr [32]byte
		cr[0] = byte(i)
		m1.Append(cr)
		m2.Append(cr)
	}
	if m1.RootHex() != m2.RootHex() {
		t.Fatal("same inputs should produce same root")
	}
}

func TestRootChangesOnAppend(t *testing.T) {
	m := New(0)
	var cr1, cr2 [32]byte
	cr1[0] = 1
	cr2[0] = 2
	m.Append(cr1)
	r1 := m.RootHex()
	m.Append(cr2)
	r2 := m.RootHex()
	if r1 == r2 {
		t.Fatal("root should change after append")
	}
}

func TestSnapshot(t *testing.T) {
	m := New(0)
	for i := 0; i < 5; i++ {
		var cr [32]byte
		cr[0] = byte(i)
		m.Append(cr)
	}
	peaks, root, count := m.Snapshot()
	if count != 5 {
		t.Fatalf("expected count 5, got %d", count)
	}
	if root == "" {
		t.Fatal("root should not be empty")
	}
	if len(peaks) == 0 {
		t.Fatal("peaks should not be empty")
	}
}

func TestCapacityBound(t *testing.T) {
	m := New(4) // max 4 leaves
	for i := 0; i < 10; i++ {
		cr := sha256.Sum256([]byte{byte(i)})
		m.Append(cr)
	}
	if m.Count() != 10 {
		t.Fatalf("count should still track all appends, got %d", m.Count())
	}
	// Peaks should be bounded
	if len(m.peaks) > 4 {
		t.Fatalf("peaks should be bounded, got %d", len(m.peaks))
	}
}
