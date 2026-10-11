package activity

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"time"

	zmq "github.com/go-zeromq/zmq4"
)

type Notification struct {
	Hash     string
	Label    byte
	Sequence uint64
	Counter  uint32
	Lost     bool
}

func Decode(frames [][]byte) (Notification, error) {
	var n Notification
	if len(frames) != 3 || string(frames[0]) != "sequence" || len(frames[2]) != 4 || (len(frames[1]) != 33 && len(frames[1]) != 41) {
		return n, errors.New("invalid sequence frame")
	}
	body := frames[1]
	n.Label = body[32]
	switch n.Label {
	case 'A', 'R':
		if len(body) != 41 {
			return n, errors.New("invalid mempool frame")
		}
		n.Sequence = binary.LittleEndian.Uint64(body[33:])
	case 'C', 'D':
		if len(body) != 33 {
			return n, errors.New("invalid block frame")
		}
	default:
		return n, errors.New("invalid sequence label")
	}
	// Core publishes the hash in display order; only the counters are little endian.
	n.Hash = hex.EncodeToString(body[:32])
	n.Counter = binary.LittleEndian.Uint32(frames[2])
	return n, nil
}

type Receiver interface {
	Receive(context.Context, func(Notification)) error
}

type ZMQReceiver struct{ URL string }

func (r ZMQReceiver) Receive(ctx context.Context, deliver func(Notification)) error {
	socket := zmq.NewSub(ctx, zmq.WithDialerTimeout(3*time.Second), zmq.WithDialerMaxRetries(1))
	defer socket.Close()
	if err := socket.SetOption(zmq.OptionSubscribe, "sequence"); err != nil {
		return err
	}
	if err := socket.Dial(r.URL); err != nil {
		return err
	}
	var counter uint32
	haveCounter := false
	for ctx.Err() == nil {
		msg, err := socket.Recv()
		if err != nil {
			return err
		}
		n, err := Decode(msg.Frames)
		if err != nil {
			deliver(Notification{Lost: true})
			continue
		}
		n.Lost = haveCounter && n.Counter != counter+1
		counter = n.Counter
		haveCounter = true
		deliver(n)
	}
	return ctx.Err()
}
