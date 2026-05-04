// Package mmr implements a Merkle Mountain Range over coherence roots.
// This is the "Synaptic Field" of the medulla-pow block header.
//
// MMR provides O(log n) append + O(log n) inclusion proofs while keeping
// the block header constant-size (just the bagged peaks root).
package mmr

import (
	"crypto/sha256"
	"encoding/hex"
)

var (
	leafPrefix = []byte{0x00}
	nodePrefix = []byte{0x01}
)

func hashLeaf(b []byte) [32]byte {
	h := sha256.New()
	h.Write(leafPrefix)
	h.Write(b)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}
func hashNode(l, r [32]byte) [32]byte {
	h := sha256.New()
	h.Write(nodePrefix)
	h.Write(l[:])
	h.Write(r[:])
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// MMR holds the rolling state of peaks. Capacity-bounded — when count exceeds
// MaxLeaves, the oldest peak is dropped (rolling window).
type MMR struct {
	peaks     [][32]byte
	count     uint64
	MaxLeaves uint64 // 0 = unbounded
}

func New(maxLeaves uint64) *MMR { return &MMR{MaxLeaves: maxLeaves} }

func (m *MMR) Append(coherenceRoot [32]byte) [32]byte {
	leaf := hashLeaf(coherenceRoot[:])
	m.count++

	height := 0
	for len(m.peaks) >= 1 && (m.count>>height)&1 == 0 {
		left := m.peaks[len(m.peaks)-1]
		m.peaks = m.peaks[:len(m.peaks)-1]
		leaf = hashNode(left, leaf)
		height++
	}
	m.peaks = append(m.peaks, leaf)

	// Capacity bound: drop oldest peak if exceeded.
	if m.MaxLeaves > 0 && m.count > m.MaxLeaves && len(m.peaks) > 1 {
		m.peaks = m.peaks[1:]
	}
	return m.Root()
}

// Root bags the peaks (right→left) into a single 32-byte commitment.
func (m *MMR) Root() [32]byte {
	if len(m.peaks) == 0 {
		var zero [32]byte
		copy(zero[:], sha256.New().Sum(nil))
		return zero
	}
	acc := m.peaks[len(m.peaks)-1]
	for i := len(m.peaks) - 2; i >= 0; i-- {
		acc = hashNode(m.peaks[i], acc)
	}
	return acc
}

func (m *MMR) Count() uint64 { return m.count }

func (m *MMR) RootHex() string {
	r := m.Root()
	return hex.EncodeToString(r[:])
}

func (m *MMR) Snapshot() (peaks []string, root string, count uint64) {
	for _, p := range m.peaks {
		peaks = append(peaks, hex.EncodeToString(p[:]))
	}
	return peaks, m.RootHex(), m.count
}
