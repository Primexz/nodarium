package server

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
)

type mockPools struct {
	windows []int
}

func (p *mockPools) Snapshot(chain *rpc.Blockchain, stale bool, window int) miningpool.Distribution {
	p.windows = append(p.windows, window)

	return miningpool.Distribution{Status: "unavailable", Window: window, Shares: []miningpool.Share{}}
}

func TestPoolWindowValidation(t *testing.T) {
	pools := &mockPools{}
	h := New(
		auth.New("secret", false),
		mockSnapshot{},
		mockHistory{},
		fstest.MapFS{"index.html": {Data: []byte("app")}},
		nil,
		nil,
		pools,
		nil,
	)
	login := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"key":"secret"}`))
	login.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	h.ServeHTTP(response, login)
	cookie := response.Result().Cookies()[0]

	for _, test := range []struct {
		query  string
		status int
	}{
		{"", 200},
		{"?blocks=144", 200},
		{"?blocks=1008", 200},
		{"?blocks=0", 400},
		{"?blocks=999999", 400},
		{"?blocks=abc", 400},
	} {
		request := httptest.NewRequest("GET", "/api/v1/mining/pools"+test.query, nil)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)

		if response.Code != test.status {
			t.Fatal(test.query, response.Code)
		}
	}

	if len(pools.windows) != 3 || pools.windows[0] != 144 || pools.windows[2] != 1008 {
		t.Fatal("invalid window reached pool service", pools.windows)
	}
}
