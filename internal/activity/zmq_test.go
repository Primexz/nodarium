package activity

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"net"
	"testing"
	"time"

	zmq "github.com/go-zeromq/zmq4"
)

func sequenceFrames(label byte, counter uint32, sequence uint64) [][]byte {
	size := 33
	if label == 'A' || label == 'R' {
		size = 41
	}
	body := make([]byte, size)
	for i := range 32 {
		body[i] = byte(i)
	}
	body[32] = label
	if size == 41 {
		binary.LittleEndian.PutUint64(body[33:], sequence)
	}
	count := make([]byte, 4)
	binary.LittleEndian.PutUint32(count, counter)
	return [][]byte{[]byte("sequence"), body, count}
}
func TestSequenceDecoding(t *testing.T) {
	for _, label := range []byte{'A', 'R', 'C', 'D'} {
		frames := sequenceFrames(label, 42, 1234)
		n, err := Decode(frames)
		hash := frames[1][:32]
		if err != nil || n.Label != label || n.Counter != 42 || n.Hash != hex.EncodeToString(hash) {
			t.Fatalf("%c: %+v %v", label, n, err)
		}
		if (label == 'A' || label == 'R') && n.Sequence != 1234 {
			t.Fatal("sequence endian error")
		}
	}
	for _, frames := range [][][]byte{nil, {[]byte("wrong"), make([]byte, 33), make([]byte, 4)}, {[]byte("sequence"), make([]byte, 41), make([]byte, 4)}, sequenceFrames('?', 1, 1), {[]byte("sequence"), make([]byte, 33), nil}} {
		if _, err := Decode(frames); err == nil {
			t.Fatal("malformed frame accepted")
		}
	}
}
func TestPureGoTransportAndSequenceLoss(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "tcp://" + listener.Addr().String()
	listener.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	pub := zmq.NewPub(ctx)
	defer pub.Close()
	if err := pub.Listen(endpoint); err != nil {
		t.Fatal(err)
	}
	notifications := make(chan Notification, 100)
	done := make(chan error, 1)
	go func() { done <- (ZMQReceiver{URL: endpoint}).Receive(ctx, func(n Notification) { notifications <- n }) }()
	// PUB/SUB has no delivery acknowledgement. Wait for a real message rather
	// than assuming a sleep has completed the subscription handshake.
	timer := time.NewTicker(25 * time.Millisecond)
	defer timer.Stop()
	connected := false
	for !connected {
		select {
		case <-ctx.Done():
			t.Fatal("subscriber never received frames")
		case <-timer.C:
			if err := pub.Send(zmq.NewMsgFrom(sequenceFrames('A', ^uint32(0), 10)...)); err != nil {
				t.Fatal(err)
			}
		case <-notifications:
			connected = true
		}
	}
	for len(notifications) > 0 {
		<-notifications
	}
	if err := pub.Send(zmq.NewMsgFrom(sequenceFrames('R', 0, 11)...)); err != nil {
		t.Fatal(err)
	}
	var n Notification
	select {
	case n = <-notifications:
	case <-ctx.Done():
		t.Fatal("wrap frame missing")
	}
	if n.Lost || n.Counter != 0 {
		t.Fatal("32-bit counter wrap treated as loss")
	}
	pub.Send(zmq.NewMsgFrom(sequenceFrames('C', 2, 0)...))
	select {
	case n = <-notifications:
	case <-ctx.Done():
		t.Fatal("gap frame missing")
	}
	if !n.Lost {
		t.Fatal("counter gap undetected")
	}
	pub.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("ZMQ receiver did not report peer disconnect")
	}
}
