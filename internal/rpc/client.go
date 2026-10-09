package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/Primexz/nodarium/internal/logging"

	"go.uber.org/zap"
)

type Caller interface {
	Call(context.Context, string, any, any) error
}

type Client struct {
	logger              *zap.Logger
	url, user, password string
	http                *http.Client
	id                  atomic.Uint64
}

func New(url, user, password string, logger *zap.Logger) *Client {
	return &Client{
		logger:   logging.Component(logger, "rpc"),
		url:      url,
		user:     user,
		password: password,
		http: &http.Client{
			Timeout: 8 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (c *Client) Call(ctx context.Context, method string, params any, out any) (callErr error) {
	started := time.Now()
	defer func() {
		fields := []zap.Field{
			zap.String("method", method),
			zap.Duration("duration", time.Since(started)),
			zap.Bool("success", callErr == nil),
		}

		// Call only returns sanitized errors; transport errors and response bodies are never logged.
		if callErr != nil {
			fields = append(fields, zap.Error(callErr))
		}

		c.logger.Debug("RPC request completed", fields...)
	}()

	if params == nil {
		params = []any{}
	}

	id := c.id.Add(1)
	b, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})

	if err != nil {
		return errors.New("invalid RPC request")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(b))

	if err != nil {
		return errors.New("invalid RPC endpoint")
	}

	req.SetBasicAuth(c.user, c.password)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)

	if err != nil {
		return errors.New("node unreachable or request timed out")
	}

	defer res.Body.Close()

	if res.StatusCode == 401 || res.StatusCode == 403 {
		return errors.New("node rejected RPC credentials")
	}

	if res.StatusCode != 200 {
		return fmt.Errorf("node returned HTTP %d", res.StatusCode)
	}

	var response struct {
		ID     uint64          `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code int `json:"code"`
		} `json:"error"`
	}

	limit := int64(8 << 20)

	// Verbose decoded blocks include transaction hex and scripts in addition
	// to the original block bytes. Keep this bounded, but allow full blocks.
	if method == "getblock" || method == "getrawtransaction" {
		limit = 32 << 20
	}

	if err := json.NewDecoder(io.LimitReader(res.Body, limit)).Decode(&response); err != nil {
		return errors.New("invalid RPC response")
	}

	if response.ID != id {
		return errors.New("mismatched RPC response")
	}

	if response.Error != nil {
		return fmt.Errorf("RPC %s failed (code %d)", method, response.Error.Code)
	}

	if len(response.Result) == 0 || string(response.Result) == "null" {
		return errors.New("empty RPC response")
	}

	if err := json.Unmarshal(response.Result, out); err != nil {
		return errors.New("unexpected RPC response format")
	}

	return nil
}
