package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestClient(t *testing.T) {
	for _, mode := range []string{"success", "auth", "malformed", "error", "id", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				u, p, ok := r.BasicAuth()

				if !ok || u != "user" || p != "secret" {
					t.Error("missing authentication")
				}

				var req struct {
					ID     uint64 `json:"id"`
					Method string `json:"method"`
				}

				json.NewDecoder(r.Body).Decode(&req)

				switch mode {
				case "auth":
					w.WriteHeader(401)

				case "malformed":
					w.Write([]byte("oops secret"))

				case "error":
					fmt.Fprintf(w, `{"id":%d,"error":{"code":-28,"message":"secret"}}`, req.ID)

				case "id":
					w.Write([]byte(`{"id":9999,"result":{}}`))

				case "redirect":
					http.Redirect(w, r, "http://example.invalid", 302)

				default:
					fmt.Fprintf(w, `{"id":%d,"result":{"chain":"regtest","blocks":10}}`, req.ID)
				}
			}))

			defer s.Close()
			var chain Blockchain

			core, logs := observer.New(zap.DebugLevel)
			err := New(s.URL+"/private-endpoint", "user", "secret", zap.New(core)).Call(
				context.Background(),
				"getblockchaininfo",
				[]string{"private-parameter"},
				&chain,
			)

			entries := logs.All()

			if len(entries) != 1 || entries[0].Level != zap.DebugLevel {
				t.Fatal("missing RPC debug log")
			}

			fields := entries[0].ContextMap()

			if fields["method"] != "getblockchaininfo" || fields["success"] != (err == nil) || fields["duration"] == nil {
				t.Fatal("missing RPC context")
			}

			data, _ := json.Marshal(fields)

			for _, sensitive := range []string{"secret", "private-endpoint", "private-parameter"} {
				if strings.Contains(entries[0].Message+string(data), sensitive) {
					t.Fatal("sensitive RPC data logged")
				}
			}

			if mode == "success" {
				if err != nil || chain.Blocks != 10 {
					t.Fatal(err, chain)
				}
			} else {
				if err == nil {
					t.Fatal("error ignored")
				}

				if strings.Contains(err.Error(), "secret") {
					t.Fatal("secret leaked")
				}
			}
		})
	}
}

func TestVerboseResponseSizeLimits(t *testing.T) {
	for _, method := range []string{"getblock", "getrawtransaction", "getblockchaininfo"} {
		t.Run(method, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					ID uint64 `json:"id"`
				}

				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)

					return
				}

				fmt.Fprintf(w, `{"id":%d,"result":{"padding":"%s"}}`, request.ID, strings.Repeat("x", 9<<20))
			}))

			defer server.Close()
			var result struct {
				Padding string `json:"padding"`
			}

			err := New(server.URL, "user", "secret", nil).Call(context.Background(), method, nil, &result)

			if method == "getblockchaininfo" {
				if err == nil {
					t.Fatal("ordinary RPC exceeded its size limit")
				}
			} else if err != nil || len(result.Padding) != 9<<20 {
				t.Fatal("full verbose response was truncated", err)
			}
		})
	}
}
