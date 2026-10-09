package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBundledSnapshot(t *testing.T) {
	path := filepath.Join("../..", assetDir)
	raw, err := os.ReadFile(filepath.Join(path, "source.json"))

	if err != nil {
		t.Fatal(err)
	}

	var meta source

	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}

	if meta.URL != repository || len(meta.Commit) != 40 || len(meta.Files) < 4 {
		t.Fatal("incomplete provenance")
	}

	for name, expected := range meta.Files {
		t.Run(name, func(t *testing.T) {
			if !fileName.MatchString(name) {
				t.Fatal("unsafe filename")
			}

			raw, err := os.ReadFile(filepath.Join(path, name))

			if err != nil {
				t.Fatal(err)
			}

			digest := sha256.Sum256(raw)

			if hex.EncodeToString(digest[:]) != expected {
				t.Fatal("asset and provenance do not match")
			}

			if err := validateSVG(raw); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRejectUnsafeSVG(t *testing.T) {
	for _, content := range []string{
		`<script>alert(1)</script>`,
		`<foreignObject><div>HTML</div></foreignObject>`,
		`<path onload="alert(1)"/>`,
		`<image href="https://example.com/tracker.png"/>`,
		`<use href="//example.com/a.svg#icon"/>`,
		`<image href="data:image/svg+xml;base64,PHN2Zz4="/>`,
		`<style>@import 'https://example.com/tracker.css';</style>`,
		`<style>.a{fill:url(https://example.com/a.svg)}</style>`,
		`<style>.a{fill:url(<![CDATA[https://example.com/a.svg]]>)}</style>`,
		`<path fill="url(https://example.com/a.svg)"/>`,
		`<animate attributeName="href" values="https://example.com/a"/>`,
		`<style>.a{fill:u\72l(https://example.com/a)}</style>`,
	} {
		t.Run(content, func(t *testing.T) {
			if err := validateSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg">` + content + `</svg>`)); err == nil {
				t.Fatal("accepted active or externally referenced artwork")
			}
		})
	}

	for _, raw := range []string{
		`<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg"><path>`,
	} {
		if err := validateSVG([]byte(raw)); err == nil {
			t.Fatalf("accepted invalid document: %s", raw)
		}
	}
}

func TestLegacyDTDRemovalPreservesArtwork(t *testing.T) {
	artwork := `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`
	prepared, err := prepareSVG([]byte(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">` + artwork))

	if err != nil || string(prepared) != artwork {
		t.Fatal("legacy DTD was not removed without changing artwork")
	}

	if _, err := prepareSVG([]byte(`<!DOCTYPE svg SYSTEM "https://example.com/a.dtd">` + artwork)); err == nil {
		t.Fatal("accepted arbitrary DTD")
	}

	prepared, err = prepareSVG([]byte(artwork + " \t\r\n"))

	if err != nil || string(prepared) != artwork+"\n" {
		t.Fatal("line endings and trailing whitespace were not normalized")
	}
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestPinnedDownloadIntegrityAndLimits(t *testing.T) {
	raw := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`)
	blob := sha1.Sum(append([]byte(fmt.Sprintf("blob %d\x00", len(raw))), raw...))
	var entries []entry

	for _, name := range []string{"default.svg", "default.light.svg", "unknown.svg", "unknown.light.svg"} {
		entries = append(entries, entry{Path: name, Type: "blob", SHA: hex.EncodeToString(blob[:]), Size: len(raw)})
	}

	client := &http.Client{Transport: transport(func(request *http.Request) (*http.Response, error) {
		if !strings.Contains(request.URL.Path, "/pinned-commit/") {
			t.Error("download not pinned")
		}

		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw))}, nil
	})}

	files, err := downloadLogos(context.Background(), client, "pinned-commit", entries)

	if err != nil || len(files) != 4 {
		t.Fatalf("valid download failed: %v", err)
	}

	for _, mutate := range []func([]entry){
		func(e []entry) { e[0].SHA = strings.Repeat("0", 40) },
		func(e []entry) { e[0].Size++ },
		func(e []entry) { e[0].Path = "../default.svg" },
		func(e []entry) { e[0].Type = "tree" },
		func(e []entry) { e[0].Path = e[1].Path },
		func(e []entry) { e[0].Size = 1 << 20 },
	} {
		broken := append([]entry(nil), entries...)
		mutate(broken)

		if _, err := downloadLogos(context.Background(), client, "pinned-commit", broken); err == nil {
			t.Fatal("accepted a corrupt or unsafe tree")
		}
	}

	for _, status := range []int{404, 429} {
		client.Transport = transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("unavailable"))}, nil
		})

		if _, err := downloadLogos(context.Background(), client, "pinned-commit", entries); err == nil {
			t.Fatal("accepted a failed download")
		}
	}

	client.Transport = transport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", maxDownload+1)))}, nil
	})

	if _, err := fetch(context.Background(), client, "https://example.com"); err == nil {
		t.Fatal("accepted oversized download")
	}
}

func TestSnapshotReplacementRemovesObsoleteAssets(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logos")

	if err := os.Mkdir(path, 0755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(path, "obsolete.svg"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := writeSnapshot(path, strings.Repeat("a", 40), map[string][]byte{"default.svg": []byte("new")}); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(path, "obsolete.svg")); !os.IsNotExist(err) {
		t.Fatal("obsolete asset survived")
	}

	files, err := os.ReadDir(dir)

	if err != nil || len(files) != 1 || files[0].Name() != "logos" {
		t.Fatal("staging or backup directory survived")
	}

	raw, err := os.ReadFile(filepath.Join(path, "source.json"))

	if err != nil {
		t.Fatal(err)
	}

	var meta source

	if err := json.Unmarshal(raw, &meta); err != nil || meta.Commit != strings.Repeat("a", 40) {
		t.Fatal("missing snapshot provenance")
	}
}
