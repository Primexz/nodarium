package rpc

import "encoding/json"

type Blockchain struct {
	Chain                string          `json:"chain"`
	Blocks               int64           `json:"blocks"`
	Headers              int64           `json:"headers"`
	BestBlockHash        string          `json:"bestblockhash"`
	Difficulty           float64         `json:"difficulty"`
	VerificationProgress float64         `json:"verificationprogress"`
	InitialBlockDownload bool            `json:"initialblockdownload"`
	SizeOnDisk           int64           `json:"size_on_disk"`
	Pruned               bool            `json:"pruned"`
	Warnings             json.RawMessage `json:"warnings"`
}

type LocalAddress struct {
	Address string `json:"address"`
	Port    int    `json:"port"`
	Score   int    `json:"score"`
}

type Network struct {
	LocalAddresses  []LocalAddress  `json:"localaddresses"`
	Version         int             `json:"version"`
	Subversion      string          `json:"subversion"`
	ProtocolVersion int             `json:"protocolversion"`
	Connections     int             `json:"connections"`
	ConnectionsIn   int             `json:"connections_in"`
	ConnectionsOut  int             `json:"connections_out"`
	NetworkActive   bool            `json:"networkactive"`
	LocalServices   []string        `json:"localservicesnames"`
	Warnings        json.RawMessage `json:"warnings"`
}

type Peer struct {
	ID             int64    `json:"id"`
	Addr           string   `json:"addr"`
	Network        string   `json:"network"`
	Subversion     string   `json:"subver"`
	Version        int      `json:"version"`
	Inbound        bool     `json:"inbound"`
	ConnectionType string   `json:"connection_type"`
	Transport      string   `json:"transport_protocol_type"`
	ConnTime       int64    `json:"conntime"`
	PingTime       *float64 `json:"pingtime"`
	MinPing        *float64 `json:"minping"`
	BytesSent      int64    `json:"bytessent"`
	BytesRecv      int64    `json:"bytesrecv"`
	Services       []string `json:"servicesnames"`
	SyncedHeaders  *int64   `json:"synced_headers"`
	SyncedBlocks   *int64   `json:"synced_blocks"`
}

type UploadTarget struct {
	Timeframe       int64 `json:"timeframe"`
	Target          int64 `json:"target"`
	Reached         bool  `json:"target_reached"`
	ServeHistorical bool  `json:"serve_historical_blocks"`
	BytesLeft       int64 `json:"bytes_left_in_cycle"`
	TimeLeft        int64 `json:"time_left_in_cycle"`
}

type NetTotals struct {
	Received     int64        `json:"totalbytesrecv"`
	Sent         int64        `json:"totalbytessent"`
	TimeMillis   int64        `json:"timemillis"`
	UploadTarget UploadTarget `json:"uploadtarget"`
}

type Mempool struct {
	Loaded     bool    `json:"loaded"`
	Size       int64   `json:"size"`
	Bytes      int64   `json:"bytes"`
	Usage      int64   `json:"usage"`
	MaxMempool int64   `json:"maxmempool"`
	TotalFee   float64 `json:"total_fee"`
	MinFee     float64 `json:"mempoolminfee"`
	RelayFee   float64 `json:"minrelaytxfee"`
}

// SmartFee rates are BTC per virtual kilobyte. A missing rate is a normal
// response when Core has not observed enough confirmed transactions yet.
type SmartFee struct {
	FeeRate *float64 `json:"feerate"`
	Blocks  int      `json:"blocks"`
	Errors  []string `json:"errors"`
}

type Block struct {
	Hash          string `json:"hash"`
	Height        int64  `json:"height"`
	Time          int64  `json:"time"`
	Confirmations int64  `json:"confirmations"`
	Previous      string `json:"previousblockhash"`
}

// BlockStats amounts are integer satoshis, not BTC. total_out excludes coinbase.
type BlockStats struct {
	BlockHash          string    `json:"blockhash"`
	TotalOut           *int64    `json:"total_out"`
	Transactions       *int64    `json:"txs"`
	TotalFee           *int64    `json:"totalfee"`
	Subsidy            *int64    `json:"subsidy"`
	AverageFeeRate     *float64  `json:"avgfeerate"`
	FeeRatePercentiles []float64 `json:"feerate_percentiles"`
}

// BlockMetadata decodes only full-block measurements from getblock verbosity 1.
// Transaction IDs in that response are intentionally discarded.
type BlockMetadata struct {
	Hash         string `json:"hash"`
	Size         *int64 `json:"size"`
	Weight       *int64 `json:"weight"`
	Transactions *int64 `json:"nTx"`
}
