package server

import (
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/blockindex"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/storage"
)

func TestPoolHistoryRoutes(t *testing.T) {
	db, err := storage.Open(t.Context(), "sqlite", filepath.Join(t.TempDir(), "pools.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	registry, err := miningpool.Parse([]byte(`[{"id":1,"name":"Pool one","tags":["/P1/"],"addresses":[]}]`))
	if err != nil {
		t.Fatal(err)
	}
	index := blockindex.New(t.Context(), nil, db, registry, nil)
	defer index.Close()
	handler := New(auth.New("test-secret", false), mockSnapshot{}, mockHistory{}, fstest.MapFS{"index.html": {Data: []byte("app")}}, nil, nil, index, nil, index)
	login := httptest.NewRequest("POST", "/api/1.0/auth/login", strings.NewReader(`{"key":"test-secret"}`))
	login.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, login)
	cookie := response.Result().Cookies()[0]
	for _, test := range []struct {
		path   string
		status int
	}{
		{"/api/1.0/mining/pools/history", 200},
		{"/api/1.0/mining/pools/history?range=7d", 200},
		{"/api/1.0/mining/pools/history?range=bogus", 400},
		{"/api/1.0/mining/pools/1", 200},
		{"/api/1.0/mining/pools/1?range=1y", 200},
		{"/api/1.0/mining/pools/1?range=bogus", 400},
		{"/api/1.0/mining/pools/9999", 404},
		{"/api/1.0/mining/pools/0", 400},
		{"/api/1.0/mining/pools/-1", 400},
		{"/api/1.0/mining/pools/abc", 400},
	} {
		request := httptest.NewRequest("GET", test.path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 401 {
			t.Fatalf("unprotected %s", test.path)
		}
		request.AddCookie(cookie)
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
	}
}
