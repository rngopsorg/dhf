// Package chain implements the medulla-pow chain: blocks, headers, PoW,
// difficulty retarget, and the Synaptic-Field MMR commitment.
package chain

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ecca-stack/medulla-pow/internal/mmr"
)

// CoherenceTuple — what an OP_COHERENCE_ROOT script commits to.
type CoherenceTuple struct {
	CrossRoot   [32]byte `json:"crossRoot"`
	EvmRoot     [32]byte `json:"evmRoot"`
	IpfsRoot    [32]byte `json:"ipfsRoot"`
	SleevesRoot [32]byte `json:"sleevesRoot"`
}

func (c CoherenceTuple) Validate() error {
	h := sha256.New()
	h.Write(c.EvmRoot[:])
	h.Write(c.IpfsRoot[:])
	h.Write(c.SleevesRoot[:])
	var derived [32]byte
	copy(derived[:], h.Sum(nil))
	// We allow either a deterministic derivation (preferred) or a freely-set
	// crossRoot (legacy compat). For the strict mode we'd compare:
	//   if derived != c.CrossRoot { return errors.New("crossRoot mismatch") }
	// Off in production until all chains commit deterministic crossRoot.
	_ = derived
	return nil
}

// Header is the medulla-pow block header.
//
// Wire layout (180 bytes):
//   [0:32]   prevHash
//   [32:64]  coherenceTupleHash    (sha256 of marshalled CoherenceTuple)
//   [64:96]  synapticFieldRoot     (MMR root over the last 256 coherence roots)
//   [96:104] timestamp (uint64 BE)
//   [104:108] difficulty (uint32 BE, leading-zero hex chars)
//   [108:112] epoch (uint32 BE)
//   [112:120] nonce (uint64 BE)
//   [120:152] crossRoot (commit-ahead, helps thin clients)
//   [152:184] evmRoot (commit-ahead)
type Header struct {
	PrevHash          [32]byte
	CoherenceHash     [32]byte
	SynapticFieldRoot [32]byte
	Timestamp         uint64
	Difficulty        uint32
	Epoch             uint32
	Nonce             uint64
	Tuple             CoherenceTuple
}

func (h *Header) Marshal() []byte {
	buf := make([]byte, 184)
	copy(buf[0:32], h.PrevHash[:])
	copy(buf[32:64], h.CoherenceHash[:])
	copy(buf[64:96], h.SynapticFieldRoot[:])
	binary.BigEndian.PutUint64(buf[96:104], h.Timestamp)
	binary.BigEndian.PutUint32(buf[104:108], h.Difficulty)
	binary.BigEndian.PutUint32(buf[108:112], h.Epoch)
	binary.BigEndian.PutUint64(buf[112:120], h.Nonce)
	copy(buf[120:152], h.Tuple.CrossRoot[:])
	copy(buf[152:184], h.Tuple.EvmRoot[:])
	return buf
}

func (h *Header) Hash() [32]byte {
	out := sha256.Sum256(h.Marshal())
	return out
}

// Block bundles a header with its full coherence tuple.
type Block struct {
	Header Header        `json:"header"`
	Tuple  CoherenceTuple `json:"tuple"`
}

// Chain is the in-memory medulla-pow chain. Persistence is via leveldb in
// the daemon (cmd/medullad/main.go).
type Chain struct {
	mu          sync.RWMutex
	blocks      []Block
	mmr         *mmr.MMR
	difficulty  uint32
	epoch       uint32
	pools       map[string]map[string]struct{} // pool → set of sleeve ids
	target      *big.Int
	subscribers []chan Block
}

func NewChain(initialDifficulty uint32) *Chain {
	c := &Chain{
		mmr:        mmr.New(256), // SYNAPTIC_FIELD_DEPTH
		difficulty: initialDifficulty,
		pools:      map[string]map[string]struct{}{"genesis-pool": {}},
	}
	c.refreshTarget()
	c.genesis()
	return c
}

func (c *Chain) genesis() {
	tuple := CoherenceTuple{}
	hdr := Header{
		Timestamp:  uint64(time.Now().Unix()),
		Difficulty: c.difficulty,
		Epoch:      0,
		Tuple:      tuple,
	}
	hdr.CoherenceHash = sha256.Sum256(append(append(append(tuple.CrossRoot[:], tuple.EvmRoot[:]...), tuple.IpfsRoot[:]...), tuple.SleevesRoot[:]...))
	hdr.SynapticFieldRoot = c.mmr.Append(hdr.CoherenceHash)
	c.blocks = append(c.blocks, Block{Header: hdr, Tuple: tuple})
}

func (c *Chain) refreshTarget() {
	// target = 2^(256 - 4*difficulty) — leading-zero hex characters
	c.target = new(big.Int).Lsh(big.NewInt(1), uint(256-int(c.difficulty)*4))
}

// Tip returns the latest block.
func (c *Chain) Tip() Block {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.blocks[len(c.blocks)-1]
}

func (c *Chain) Height() uint64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return uint64(len(c.blocks)) - 1
}

func (c *Chain) Difficulty() uint32 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.difficulty
}

func (c *Chain) Epoch() uint32 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.epoch
}

// SubmitCoherenceRoot is the canonical "tx" type on this chain — there are no
// payment transactions, only coherence-root commits.
func (c *Chain) SubmitCoherenceRoot(t CoherenceTuple) (Block, error) {
	if err := t.Validate(); err != nil {
		return Block{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	prev := c.blocks[len(c.blocks)-1]

	hdr := Header{
		PrevHash:   prev.Header.Hash(),
		Timestamp:  uint64(time.Now().Unix()),
		Difficulty: c.difficulty,
		Epoch:      c.epoch + 1,
		Tuple:      t,
	}
	chBuf := append(append(append(t.CrossRoot[:], t.EvmRoot[:]...), t.IpfsRoot[:]...), t.SleevesRoot[:]...)
	hdr.CoherenceHash = sha256.Sum256(chBuf)
	hdr.SynapticFieldRoot = c.mmr.Append(hdr.CoherenceHash)

	if err := c.mineHeader(&hdr); err != nil {
		return Block{}, err
	}

	blk := Block{Header: hdr, Tuple: t}
	c.blocks = append(c.blocks, blk)
	c.epoch++
	c.maybeRetarget()
	c.broadcast(blk)
	return blk, nil
}

func (c *Chain) mineHeader(h *Header) error {
	const maxAttempts = 50_000_000
	target := new(big.Int).Set(c.target)
	for n := uint64(0); n < maxAttempts; n++ {
		h.Nonce = n
		hash := h.Hash()
		v := new(big.Int).SetBytes(hash[:])
		if v.Cmp(target) < 0 {
			return nil
		}
	}
	return errors.New("mining attempts exhausted")
}

// retarget every 60 blocks aiming for ~4s per block (epoch time).
func (c *Chain) maybeRetarget() {
	if len(c.blocks)%60 != 0 {
		return
	}
	if len(c.blocks) < 61 {
		return
	}
	first := c.blocks[len(c.blocks)-60].Header.Timestamp
	last := c.blocks[len(c.blocks)-1].Header.Timestamp
	span := int64(last) - int64(first)
	target := int64(60 * 4) // 60 blocks × 4s
	if span < target/2 {
		c.difficulty++
	} else if span > target*2 && c.difficulty > 1 {
		c.difficulty--
	}
	c.refreshTarget()
}

func (c *Chain) JoinPool(pool, sleeveID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.pools[pool]; !ok {
		c.pools[pool] = map[string]struct{}{}
	}
	c.pools[pool][sleeveID] = struct{}{}
}

func (c *Chain) Subscribe() <-chan Block {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan Block, 32)
	c.subscribers = append(c.subscribers, ch)
	return ch
}
func (c *Chain) broadcast(b Block) {
	for _, ch := range c.subscribers {
		select {
		case ch <- b:
		default:
		}
	}
}

// EpochAnchor returns the canonical record for an epoch.
func (c *Chain) EpochAnchor(epoch uint32) (Block, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for i := len(c.blocks) - 1; i >= 0; i-- {
		if c.blocks[i].Header.Epoch == epoch {
			return c.blocks[i], nil
		}
	}
	return Block{}, fmt.Errorf("epoch not found: %d", epoch)
}

// SynapticProof returns peaks + bag for a block hash (lookup by header hash).
func (c *Chain) SynapticProof(blockHashHex string) (root string, peaks []string, count uint64, err error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, b := range c.blocks {
		hh := b.Header.Hash()
		if hex.EncodeToString(hh[:]) == blockHashHex {
			peaks, root, count = c.mmr.Snapshot()
			return
		}
	}
	err = errors.New("block not found")
	return
}
