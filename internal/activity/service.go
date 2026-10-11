// Package activity joins observed node/chain events with a bounded live mempool sample.
package activity

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/logging"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
	"go.uber.org/zap"
)

const MaxTransactions = 500
const MaxMembers = 200000

const metadataPerWindow = 200
const metadataWorkers = 4

type Snapshots interface{ Snapshot() collector.Snapshot }
type Store interface {
	SaveActivity(context.Context, storage.ActivityEvent) error
	Activity(context.Context, string, string, int64, string) (storage.ActivityPage, error)
	PruneActivity(context.Context) error
}

type Transaction struct {
	TxID       string   `json:"txid"`
	At         int64    `json:"at"`
	VSize      *int64   `json:"vsize"`
	FeeRate    *float64 `json:"fee_rate"`
	OutputSats *string  `json:"output_sats"`
}

type Block struct {
	Hash         string        `json:"hash"`
	Height       int64         `json:"height"`
	Time         int64         `json:"time"`
	Transactions []Transaction `json:"transactions"`
}

type Live struct {
	Source           string        `json:"source"`
	Status           string        `json:"status"`
	At               int64         `json:"at"`
	Generation       uint64        `json:"generation"`
	Count            int           `json:"count"`
	Arrivals         uint64        `json:"arrivals"`
	Transactions     []Transaction `json:"transactions"`
	Block            *Block        `json:"block"`
	PersistenceError bool          `json:"persistence_error"`
	Projection       *Projection   `json:"projection"`
	ProjectionError  bool          `json:"projection_error"`
}

type removedTransaction struct {
	tx Transaction
	at time.Time
}

type enrichment struct {
	generation   uint64
	transactions []Transaction
}

type Message struct {
	ID   string
	Kind string
	Data json.RawMessage
}

type subscription struct {
	live  bool
	queue chan Message
}

type Service struct {
	projectionResults chan projectionResult
	projectionBusy    bool
	lastProjection    time.Time
	enrichResults     chan enrichment
	enrichBusy        bool
	enrichWG          sync.WaitGroup
	ctx               context.Context
	cancel            context.CancelFunc
	done              chan struct{}
	rpc               rpc.Caller
	snapshots         Snapshots
	store             Store
	logger            *zap.Logger
	receiver          Receiver
	observeChain      func(*rpc.Blockchain)
	notifications     chan Notification
	lost              atomic.Bool
	mu                sync.Mutex
	live              Live
	dirty             bool
	node              string
	subscribers       map[*subscription]bool
	replay            []Message
	serial            uint64
	session           string
	idleAt            time.Time
	// The remaining fields belong exclusively to run.
	members        map[string]bool
	sample         map[string]Transaction
	removed        map[string]removedTransaction
	lastChainPoll  time.Time
	uptime         int64
	historyGap     bool
	sequence       uint64
	baseline       bool
	zmqReady       bool
	metadataAt     time.Time
	metadataBudget int
	metadataTried  map[string]bool
	tip            *rpc.Block
	status         string
	checkedAt      int64
	lastPoll       time.Time
	lastReconcile  time.Time
	pending        []storage.ActivityEvent
	lastPrune      time.Time
}

func New(ctx context.Context, client rpc.Caller, snapshots Snapshots, store Store, receiver Receiver, logger *zap.Logger, observe func(*rpc.Blockchain)) *Service {
	ctx, cancel := context.WithCancel(ctx)
	id := make([]byte, 16)
	rand.Read(id)
	s := &Service{
		ctx:               ctx,
		cancel:            cancel,
		done:              make(chan struct{}),
		rpc:               client,
		snapshots:         snapshots,
		store:             store,
		receiver:          receiver,
		logger:            logging.Component(logger, "activity"),
		observeChain:      observe,
		notifications:     make(chan Notification, 10000),
		enrichResults:     make(chan enrichment, 1),
		projectionResults: make(chan projectionResult, 1),
		subscribers:       map[*subscription]bool{},
		session:           hex.EncodeToString(id),
		sample:            map[string]Transaction{},
		removed:           map[string]removedTransaction{},
		members:           map[string]bool{},
		metadataTried:     map[string]bool{},
		live:              Live{Source: "rpc", Status: "waiting", Transactions: []Transaction{}},
	}
	go s.run()
	return s
}

func (s *Service) Close() {
	s.cancel()
	<-s.done
}

func (s *Service) Snapshot() Live {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.live
}

func (s *Service) Node() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.node
}

func (s *Service) Events(ctx context.Context, kind string, at int64, id string) (storage.ActivityPage, error) {
	p, err := s.store.Activity(ctx, s.Node(), kind, at, id)
	p.PersistenceError = s.Snapshot().PersistenceError
	return p, err
}

func (s *Service) publish(kind string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.publishLocked(kind, raw)
}

func (s *Service) publishLocked(kind string, raw json.RawMessage) {
	s.serial++
	msg := Message{ID: fmt.Sprintf("%s:%d", s.session, s.serial), Kind: kind, Data: raw}
	s.replay = append(s.replay, msg)
	total := 0
	keep := len(s.replay)
	for i := len(s.replay) - 1; i >= 0; i-- {
		total += len(s.replay[i].Data)
		if total > 8<<20 || len(s.replay)-i > 1000 {
			keep = i + 1
			break
		} else {
			keep = i
		}
	}
	if keep > 0 {
		s.replay = slices.Clone(s.replay[keep:])
	}
	for sub := range s.subscribers {
		if !sub.live && kind == "live" {
			continue
		}
		select {
		case sub.queue <- msg:
		default:
			delete(s.subscribers, sub)
			close(sub.queue)
		}
	}
}

// Subscribe registers before producing a snapshot, so there is no bootstrap gap.
func (s *Service) Subscribe(live bool, lastID string) (<-chan Message, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.subscribers) >= 16 || s.ctx.Err() != nil {
		return nil, func() {}
	}
	sub := &subscription{live: live, queue: make(chan Message, 1100)}
	s.subscribers[sub] = true
	s.idleAt = time.Time{}
	replayAt := slices.IndexFunc(s.replay, func(m Message) bool { return m.ID == lastID })
	if replayAt >= 0 {
		for _, msg := range s.replay[replayAt+1:] {
			if live || msg.Kind != "live" {
				sub.queue <- msg
			}
		}
	} else if lastID != "" {
		sub.queue <- Message{Kind: "reset", Data: json.RawMessage(`{}`)}
	}
	raw, _ := json.Marshal(s.live)
	sub.queue <- Message{Kind: "snapshot", Data: raw}
	return sub.queue, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.subscribers[sub] {
			delete(s.subscribers, sub)
			close(sub.queue)
		}
	}
}

func (s *Service) active() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for sub := range s.subscribers {
		if sub.live {
			return true
		}
	}
	if s.idleAt.IsZero() {
		s.idleAt = time.Now()
	}
	return time.Since(s.idleAt) < 15*time.Second && s.baseline
}

func (s *Service) update(status string) {
	source := "rpc"
	if s.zmqReady {
		source = "zmq"
	}
	s.mu.Lock()
	unchanged := !s.dirty && s.live.Status == status && s.live.Source == source
	s.mu.Unlock()
	if unchanged {
		return
	}
	s.dirty = false
	txs := slices.SortedFunc(maps.Values(s.sample), func(a, b Transaction) int {
		if a.At > b.At {
			return -1
		}
		if a.At < b.At {
			return 1
		}
		return cmp.Compare(a.TxID, b.TxID)
	})
	if txs == nil {
		txs = []Transaction{}
	}
	s.mu.Lock()
	s.live.Transactions = txs
	s.live.Count = len(s.members)
	s.live.At = time.Now().UnixMilli()
	s.live.Status = status
	s.live.Source = source
	live := s.live
	s.mu.Unlock()
	s.publish("live", live)
}

func (s *Service) reset(status string) {
	s.lastProjection = time.Time{}
	s.dirty = true
	clear(s.members)
	clear(s.sample)
	clear(s.removed)
	clear(s.metadataTried)
	s.baseline = false
	s.zmqReady = false
	s.mu.Lock()
	s.live.Generation++
	s.live.Arrivals = 0
	s.live.Block = nil
	s.live.Projection = nil
	s.live.ProjectionError = false
	if s.tip != nil && status != "unavailable" {
		s.live.Block = &Block{Hash: s.tip.Hash, Height: s.tip.Height, Time: s.tip.Time, Transactions: []Transaction{}}
	}
	s.mu.Unlock()
	s.update(status)
	s.publish("reset", map[string]string{"reason": status})
}

func (s *Service) emit(event storage.ActivityEvent) {
	id := make([]byte, 16)
	rand.Read(id)
	event.ID = hex.EncodeToString(id)
	event.Node = s.Node()
	event.At = time.Now().UnixMilli()
	if event.Node == "" {
		return
	}
	if len(s.pending) >= 1000 {
		s.historyGap = true
		s.setPersistenceError(true)
		return
	}
	s.pending = append(s.pending, event)
}

func (s *Service) setPersistenceError(failed bool) {
	s.mu.Lock()
	changed := s.live.PersistenceError != failed
	s.live.PersistenceError = failed
	s.mu.Unlock()
	if changed {
		s.publish("status", s.Snapshot())
	}
}

func (s *Service) persist(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, time.Second)
	defer cancel()
	for len(s.pending) > 0 {
		if err := s.store.SaveActivity(ctx, s.pending[0]); err != nil {
			s.setPersistenceError(true)
			return
		}
		// Notify timeline readers only after its cursor-backed row is durable.
		s.publish("event", s.pending[0])
		s.pending = s.pending[1:]
	}
	s.setPersistenceError(s.historyGap)
	if time.Since(s.lastPrune) > time.Hour {
		if err := s.store.PruneActivity(ctx); err == nil {
			s.lastPrune = time.Now()
		} else {
			s.setPersistenceError(true)
		}
	}
}

func (s *Service) receive() {
	backoff := time.Second
	for s.ctx.Err() == nil {
		err := s.receiver.Receive(s.ctx, func(n Notification) {
			select {
			case s.notifications <- n:
			default:
				s.lost.Store(true)
			}
		})
		if s.ctx.Err() != nil {
			return
		}
		s.lost.Store(true)
		if err != nil {
			s.logger.Debug("Activity notifications unavailable; using RPC")
		}
		select {
		case <-s.ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(30*time.Second, backoff*2)
	}
}

func (s *Service) run() {
	defer close(s.done)
	defer s.enrichWG.Wait()
	var wg sync.WaitGroup
	if s.receiver != nil {
		wg.Go(s.receive)
	}
	defer wg.Wait()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	lastPersist := time.Time{}
	for {
		select {
		case <-s.ctx.Done():
			if len(s.pending) > 0 {
				s.persist(context.WithoutCancel(s.ctx))
			}
			s.mu.Lock()
			for sub := range s.subscribers {
				close(sub.queue)
				delete(s.subscribers, sub)
			}
			s.mu.Unlock()
			return
		case result := <-s.enrichResults:
			s.enrichBusy = false
			if result.generation == s.Snapshot().Generation {
				for _, tx := range result.transactions {
					if _, ok := s.sample[tx.TxID]; ok {
						s.sample[tx.TxID] = tx
						s.dirty = true
					}
				}
				s.update("ready")
			}
		case result := <-s.projectionResults:
			s.projectionBusy = false
			if result.generation == s.Snapshot().Generation {
				s.mu.Lock()
				s.live.ProjectionError = result.err != nil
				if result.err == nil {
					s.live.Projection = result.projection
				}
				s.mu.Unlock()
				s.dirty = true
				s.update("ready")
			}
		case n := <-s.notifications:
			if n.Lost || s.lost.Swap(false) {
				s.lastPoll = time.Time{}
				s.reset("resynchronizing")
			}
			if n.Label == 'C' || n.Label == 'D' {
				s.refreshChain()
			}
			if s.active() && s.baseline && n.Hash != "" {
				if n.Label == 'A' || n.Label == 'R' {
					if n.Sequence < s.sequence {
						continue
					}
					if n.Sequence != s.sequence {
						// Mining increments mempool_sequence without R notifications.
						// Verify the chain before treating a sequence jump as a lost message.
						s.refreshChain()
					}
					if n.Sequence < s.sequence {
						continue
					}
					if n.Sequence != s.sequence {
						s.lastPoll = time.Time{}
						s.reset("resynchronizing")
						continue
					}
					s.sequence++
					if n.Label == 'A' {
						s.add(n.Hash, true)
					} else {
						s.remove(n.Hash)
					}
					if s.baseline {
						s.zmqReady = true
					}
				}
			}
		case <-tick.C:
			if s.lost.Swap(false) {
				s.lastPoll = time.Time{}
				s.reset("resynchronizing")
			}
			snap := s.snapshots.Snapshot()
			if snap.Node != "" && snap.Node != s.Node() {
				s.mu.Lock()
				s.node = snap.Node
				s.mu.Unlock()
				s.status = ""
				s.tip = nil
				s.reset("waiting")
			}
			if snap.Status != s.status {
				if s.status != "" && s.status != "connecting" {
					s.emit(storage.ActivityEvent{Kind: "connection", Status: snap.Status, PreviousStatus: s.status})
				}
				s.status = snap.Status
			}
			ready := snap.Overview.Data != nil && !snap.Overview.Stale && !snap.Overview.Data.Blockchain.InitialBlockDownload
			if !ready {
				s.tip = nil
				if s.baseline || s.Snapshot().Status != "unavailable" {
					s.reset("unavailable")
				}
			} else {
				if uptime := snap.Overview.Data.Uptime; uptime != nil && s.uptime > 0 && *uptime < s.uptime {
					s.tip = nil
					s.reset("resynchronizing")
				}
				if snap.Overview.Data.Uptime != nil {
					s.uptime = *snap.Overview.Data.Uptime
				}
				checked := int64(0)
				if snap.Overview.UpdatedAt != nil {
					checked = snap.Overview.UpdatedAt.UnixMilli()
				}
				if checked != s.checkedAt {
					s.checkedAt = checked
					s.chain(snap.Overview.Data.Blockchain)
				}
				if time.Since(s.lastChainPoll) >= 5*time.Second && !s.zmqReady {
					s.refreshChain()
				}
				if s.active() {
					due := (!s.baseline || !s.zmqReady) && time.Since(s.lastPoll) >= 5*time.Second || time.Since(s.lastReconcile) >= 30*time.Second
					if due {
						s.poll()
					}
					if s.baseline {
						s.enrich()
						s.project()
					}
					if s.baseline {
						s.update("ready")
					}
				} else if s.baseline {
					s.reset("waiting")
				}
			}
			if time.Since(lastPersist) >= time.Second {
				s.persist(s.ctx)
				lastPersist = time.Now()
			}
		}
	}
}

func (s *Service) add(id string, arrival bool) {
	if s.members[id] {
		return
	}
	if len(s.members) >= MaxMembers {
		s.reset("capacity")
		return
	}
	s.dirty = true
	s.members[id] = true
	if arrival {
		s.mu.Lock()
		s.live.Arrivals++
		s.mu.Unlock()
	}
	if len(s.sample) >= MaxTransactions {
		oldest := ""
		var at int64
		for id, tx := range s.sample {
			if oldest == "" || tx.At < at {
				oldest = id
				at = tx.At
			}
		}
		delete(s.sample, oldest)
		delete(s.metadataTried, oldest)
	}
	s.sample[id] = Transaction{TxID: id, At: time.Now().UnixMilli()}
}

func (s *Service) poll() {
	s.lastPoll = time.Now()
	s.lastReconcile = time.Now()
	var result struct {
		TxIDs    []string `json:"txids"`
		Sequence uint64   `json:"mempool_sequence"`
	}
	ctx, cancel := context.WithTimeout(s.ctx, 3*time.Second)
	defer cancel()
	if err := s.rpc.Call(ctx, "getrawmempool", []any{false, true}, &result); err != nil {
		s.reset("unavailable")
		return
	}
	if len(result.TxIDs) > MaxMembers {
		s.reset("capacity")
		return
	}
	current := make(map[string]bool, len(result.TxIDs))
	for _, id := range result.TxIDs {
		current[id] = true
	}
	if s.baseline && (result.Sequence < s.sequence || s.zmqReady && result.Sequence != s.sequence) {
		s.reset("resynchronizing")
	}
	if s.baseline {
		for id := range s.sample {
			if !current[id] {
				s.remove(id)
			}
		}
		for id := range s.members {
			if !current[id] {
				delete(s.members, id)
			}
		}
		for _, id := range result.TxIDs {
			if !s.members[id] {
				s.add(id, true)
			}
		}
	} else {
		for _, id := range result.TxIDs[:min(50, len(result.TxIDs))] {
			s.add(id, false)
		}
	}
	s.dirty = true
	s.members = current
	s.sequence = result.Sequence
	s.baseline = true
	s.update("ready")
}

func (s *Service) enrich() {
	if s.enrichBusy {
		return
	}
	if time.Since(s.metadataAt) >= 5*time.Second {
		s.metadataAt = time.Now()
		s.metadataBudget = metadataPerWindow
		clear(s.metadataTried)
	}
	if s.metadataBudget <= 0 {
		return
	}
	queued := []Transaction{}
	for id, tx := range s.sample {
		if (tx.VSize == nil || tx.FeeRate == nil || tx.OutputSats == nil) && !s.metadataTried[id] {
			queued = append(queued, tx)
		}
	}
	// New arrivals should become readable before older incomplete metadata.
	slices.SortFunc(queued, func(a, b Transaction) int {
		return cmp.Or(cmp.Compare(b.At, a.At), cmp.Compare(a.TxID, b.TxID))
	})
	ids := make([]string, min(len(queued), metadataWorkers, s.metadataBudget))
	for i := range ids {
		ids[i] = queued[i].TxID
	}
	if len(ids) == 0 {
		return
	}
	s.metadataBudget -= len(ids)
	results := make([]Transaction, len(ids))
	for i, id := range ids {
		s.metadataTried[id] = true
		results[i] = s.sample[id]
	}
	s.enrichBusy = true
	generation := s.Snapshot().Generation
	s.enrichWG.Go(func() {
		ctx, cancel := context.WithTimeout(s.ctx, 2*time.Second)
		defer cancel()
		var wg sync.WaitGroup
		for i, id := range ids {
			wg.Go(func() {
				var entry struct {
					VSize int64 `json:"vsize"`
					Fees  struct {
						Base float64 `json:"base"`
					} `json:"fees"`
				}
				if results[i].VSize == nil || results[i].FeeRate == nil {
					if s.rpc.Call(ctx, "getmempoolentry", []any{id}, &entry) == nil && entry.VSize > 0 {
						results[i].VSize = new(entry.VSize)
						results[i].FeeRate = new(entry.Fees.Base * 1e8 / float64(entry.VSize))
					}
				}

				if results[i].OutputSats == nil {
					if summary, err := explorer.MempoolSummary(ctx, s.rpc, id); err == nil {
						results[i].OutputSats = summary.OutputSats
						if results[i].VSize == nil {
							results[i].VSize = new(summary.VSize)
						}
					}
				}
			})
		}
		wg.Wait()
		select {
		case s.enrichResults <- enrichment{generation, results}:
		case <-s.ctx.Done():
		}
	})
}

// Retain a small removed sample briefly: RPC may observe mining before the
// collector sees its block. Only a verified block can mark a tile confirmed.
func (s *Service) remove(id string) {
	s.dirty = true
	if tx, ok := s.sample[id]; ok {
		if len(s.removed) >= MaxTransactions {
			clear(s.removed)
		}
		s.removed[id] = removedTransaction{tx, time.Now()}
	}
	delete(s.members, id)
	delete(s.sample, id)
	delete(s.metadataTried, id)
}

func (s *Service) refreshChain() {
	s.lastChainPoll = time.Now()
	ctx, cancel := context.WithTimeout(s.ctx, 3*time.Second)
	defer cancel()
	var chain rpc.Blockchain
	if s.rpc.Call(ctx, "getblockchaininfo", nil, &chain) == nil && !chain.InitialBlockDownload {
		if s.observeChain != nil {
			s.observeChain(&chain)
		}
		s.chain(chain)
	}
}
