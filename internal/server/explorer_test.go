package server

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/explorer"
)

type mockExplorer struct {
	err error
}

func (m mockExplorer) Block(ctx context.Context, hash string) (explorer.Block, error) {
	if _, ok := ctx.Deadline(); !ok {
		panic("missing RPC deadline")
	}

	return explorer.Block{Hash: hash, Transactions: []explorer.Summary{}}, m.err
}

func (m mockExplorer) Transaction(ctx context.Context, hash, txid string) (explorer.Transaction, error) {
	return explorer.Transaction{Summary: explorer.Summary{TXID: txid}, BlockHash: hash}, m.err
}

func TestAuthenticatedExplorerRoutes(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
	}{
		{nil, 200}, {explorer.ErrInvalid, 400}, {explorer.ErrNotFound, 404},
		{explorer.ErrInactive, 409}, {explorer.ErrUnavailable, 503}, {errors.New("private RPC credentials"), 503},
	} {
		manager := auth.New("secret", false)
		h := New(
			manager,
			mockSnapshot{},
			mockHistory{},
			fstest.MapFS{"index.html": {Data: []byte("app")}},
			nil,
			mockExplorer{test.err},
			nil,
			nil,
		)
		login := httptest.NewRequest("POST", "/api/1.0/auth/login", strings.NewReader(`{"key":"secret"}`))
		login.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		h.ServeHTTP(response, login)

		if response.Code != 200 {
			t.Fatal("login", response.Code)
		}

		cookie := response.Result().Cookies()[0]

		for _, path := range []string{"/api/1.0/blocks/block/transactions", "/api/1.0/blocks/block/transactions/transaction"} {
			request := httptest.NewRequest("GET", path, nil)
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			h.ServeHTTP(response, request)

			if response.Code != test.status {
				t.Fatal(path, response.Code, response.Body.String())
			}

			if strings.Contains(response.Body.String(), "private RPC credentials") {
				t.Fatal("RPC error leaked")
			}

			if response.Header().Get("Content-Type") != "application/json" {
				t.Fatal("invalid content type")
			}
		}
	}
}
