package geoip

import (
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// download validates a bounded compressed database before replacing the cache.
// Readers retain the previous database during downloads and failed updates.
func (s *Service) download(ctx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)

	if err != nil {
		return err
	}

	client := http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 || req.URL.Scheme != "https" || req.URL.Host != "download.db-ip.com" {
			return errors.New("unexpected download redirect")
		}

		return nil
	}}

	res, err := client.Do(req)

	if err != nil {
		return errors.New("GeoIP download unavailable")
	}

	defer res.Body.Close()

	if res.StatusCode != http.StatusOK || res.ContentLength > 128<<20 {
		return errors.New("invalid GeoIP download response")
	}

	zipped, err := gzip.NewReader(io.LimitReader(res.Body, 128<<20))

	if err != nil {
		return errors.New("invalid compressed GeoIP data")
	}

	defer zipped.Close()

	if err := os.MkdirAll(filepath.Dir(s.config.Path), 0700); err != nil {
		return err
	}

	f, err := os.CreateTemp(filepath.Dir(s.config.Path), ".geoip-*.mmdb")

	if err != nil {
		return err
	}

	defer os.Remove(f.Name())

	count, copyErr := io.Copy(f, io.LimitReader(zipped, (512<<20)+1))
	closeErr := f.Close()

	if copyErr != nil || closeErr != nil || count > 512<<20 {
		return errors.New("incomplete or oversized GeoIP database")
	}

	db, err := openDatabase(f.Name())

	if err != nil {
		return err
	}

	if ctx.Err() != nil {
		db.Close()

		return ctx.Err()
	}

	if err := os.Rename(f.Name(), s.config.Path); err != nil {
		db.Close()

		return err
	}

	s.mu.Lock()
	old := s.db
	s.db = db

	if old != nil {
		old.Close()
	}

	s.mu.Unlock()

	return nil
}
