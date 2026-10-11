package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Primexz/nodarium/internal/activity"
	"github.com/Primexz/nodarium/internal/auth"
)

func registerActivity(mux *http.ServeMux, a *auth.Manager, s *activity.Service) {
	mux.HandleFunc("GET /api/1.0/activity/live", func(w http.ResponseWriter, r *http.Request) { jsonResponse(w, 200, s.Snapshot()) })
	mux.HandleFunc("GET /api/1.0/activity/events", func(w http.ResponseWriter, r *http.Request) {
		kind := r.URL.Query().Get("kind")
		if kind != "" && kind != "connection" && kind != "block" && kind != "reorg" {
			jsonResponse(w, 400, map[string]string{"error": "Invalid event category"})
			return
		}
		var at int64
		id := ""
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			raw, err := base64.RawURLEncoding.DecodeString(cursor)
			parts := strings.SplitN(string(raw), ":", 3)
			if err != nil || len(parts) != 3 || parts[0] != s.Node() {
				jsonResponse(w, 400, map[string]string{"error": "Invalid activity cursor"})
				return
			}
			at, err = strconv.ParseInt(parts[1], 10, 64)
			id = parts[2]
			if err != nil || len(id) != 32 {
				jsonResponse(w, 400, map[string]string{"error": "Invalid activity cursor"})
				return
			}
		}
		page, err := s.Events(r.Context(), kind, at, id)
		if err != nil {
			jsonResponse(w, 503, map[string]string{"error": "Activity history unavailable"})
			return
		}
		if len(page.Events) == 50 {
			last := page.Events[len(page.Events)-1]
			page.Cursor = base64.RawURLEncoding.EncodeToString(fmt.Appendf(nil, "%s:%d:%s", s.Node(), last.At, last.ID))
		}
		jsonResponse(w, 200, page)
	})
	mux.HandleFunc("GET /api/1.0/activity/stream", func(w http.ResponseWriter, r *http.Request) {
		view := r.URL.Query().Get("view")
		if view != "live" && view != "timeline" {
			jsonResponse(w, 400, map[string]string{"error": "Invalid activity view"})
			return
		}
		control := http.NewResponseController(w)
		if err := control.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
			jsonResponse(w, 503, map[string]string{"error": "Streaming unavailable"})
			return
		}
		messages, unsubscribe := s.Subscribe(view == "live", r.Header.Get("Last-Event-ID"))
		if messages == nil {
			jsonResponse(w, 503, map[string]string{"error": "Activity stream capacity reached"})
			return
		}
		defer unsubscribe()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("X-Accel-Buffering", "no")
		w.Header().Set("Cache-Control", "no-cache, no-store")
		w.WriteHeader(200)
		write := func(msg activity.Message) bool {
			if control.SetWriteDeadline(time.Now().Add(5*time.Second)) != nil {
				return false
			}
			if msg.ID != "" {
				if _, err := fmt.Fprintf(w, "id: %s\n", msg.ID); err != nil {
					return false
				}
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Kind, msg.Data); err != nil {
				return false
			}
			return control.Flush() == nil && control.SetWriteDeadline(time.Time{}) == nil
		}

		heartbeat := time.NewTicker(10 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case msg, ok := <-messages:
				if !ok || !write(msg) {
					return
				}
			case <-heartbeat.C:
				if !a.Valid(r) {
					write(activity.Message{Kind: "expired", Data: json.RawMessage(`{}`)})
					return
				}
				if control.SetWriteDeadline(time.Now().Add(5*time.Second)) != nil {
					return
				}
				if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
					return
				}
				if control.Flush() != nil || control.SetWriteDeadline(time.Time{}) != nil {
					return
				}
			}
		}
	})
}
