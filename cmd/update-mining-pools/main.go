// Update the bundled official pool definitions without changing a running node.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/Primexz/nodarium/internal/miningpool"
)

func fetch(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, "GET", url, nil)

	if err != nil {
		return nil, err
	}

	request.Header.Set("User-Agent", "Nodarium-pool-definitions-updater")
	response, err := client.Do(request)

	if err != nil {
		return nil, err
	}

	defer response.Body.Close()

	if response.StatusCode != 200 {
		return nil, fmt.Errorf("upstream returned HTTP %d", response.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))

	if err != nil || len(raw) > 2<<20 {
		return nil, errors.New("incomplete or oversized definitions")
	}

	return raw, nil
}

func replace(path string, raw []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".pools-update-*")

	if err != nil {
		return err
	}

	defer os.Remove(f.Name())

	if _, err := f.Write(raw); err != nil {
		f.Close()

		return err
	}

	if err := f.Close(); err != nil {
		return err
	}

	if err := os.Chmod(f.Name(), 0644); err != nil {
		return err
	}

	return os.Rename(f.Name(), path)
}

func update() error {
	if _, err := os.Stat("internal/miningpool/data/LICENSE"); err != nil {
		return errors.New("run from the Nodarium repository root")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	raw, err := fetch(ctx, client, "https://api.github.com/repos/mempool/mining-pools/commits/master")

	if err != nil {
		return err
	}

	var revision struct {
		SHA string `json:"sha"`
	}

	if err := json.Unmarshal(raw, &revision); err != nil {
		return err
	}

	if len(revision.SHA) != 40 {
		return errors.New("invalid upstream revision")
	}

	if _, err := hex.DecodeString(revision.SHA); err != nil {
		return errors.New("invalid upstream revision")
	}

	raw, err = fetch(ctx, client, "https://raw.githubusercontent.com/mempool/mining-pools/"+revision.SHA+"/pools-v2.json")

	if err != nil {
		return err
	}

	if _, err := miningpool.Parse(raw); err != nil {
		return err
	}

	digest := sha256.Sum256(raw)
	meta, err := json.MarshalIndent(
		miningpool.Source{
			URL:    "https://github.com/mempool/mining-pools",
			Commit: revision.SHA,
			SHA256: hex.EncodeToString(digest[:]),
		},
		"",
		"  ",
	)

	if err != nil {
		return err
	}

	// Every download and validation finishes before touching the local snapshot.
	// Individual writes are atomic; embedded provenance validation detects a
	// interrupted pair so a mismatched snapshot can never be used at runtime.
	if err := replace("internal/miningpool/data/pools-v2.json", raw); err != nil {
		return err
	}

	if err := replace("internal/miningpool/data/source.json", append(meta, '\n')); err != nil {
		return err
	}

	fmt.Printf("Updated mining pool definitions to %s. Rebuild Nodarium to use them.\n", revision.SHA)

	return nil
}

func main() {
	if err := update(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
