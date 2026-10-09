// Fetch a validated, revision-pinned snapshot of the official mining pool logos.
package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const repository = "https://github.com/mempool/mining-pool-logos"
const assetDir = "web/src/assets/mining-pool-logos"
const maxDownload = 1 << 20

var fileName = regexp.MustCompile(`^[a-z0-9]+(\.light)?\.svg$`)
var revisionName = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
var cssURL = regexp.MustCompile(`(?i)url\s*\(([^)]*)\)`)

func prepareSVG(raw []byte) ([]byte, error) {
	// Two upstream logos carry this legacy external DTD. Remove only the
	// exact standard declaration; validation still rejects all other directives.
	dtd := []byte(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">`)
	prepared := bytes.ReplaceAll(raw, dtd, nil)
	lines := bytes.Split(prepared, []byte{'\n'})

	for i, line := range lines {
		lines[i] = bytes.TrimRight(line, " \t\r")
	}

	prepared = bytes.Join(lines, []byte{'\n'})

	return prepared, validateSVG(prepared)
}

type entry struct {
	Path string `json:"path"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
	Size int    `json:"size"`
}

type source struct {
	URL    string            `json:"source"`
	Commit string            `json:"commit"`
	Files  map[string]string `json:"files"`
}

func fetch(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)

	if err != nil {
		return nil, err
	}

	request.Header.Set("User-Agent", "Nodarium-pool-logos-updater")
	response, err := client.Do(request)

	if err != nil {
		return nil, err
	}

	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned HTTP %d", response.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(response.Body, maxDownload+1))

	if err != nil || len(raw) > maxDownload {
		return nil, errors.New("incomplete or oversized logo download")
	}

	return raw, nil
}

func internalCSS(value string) bool {
	lower := strings.ToLower(value)

	// No imports, escaped tokens, script URLs, or external CSS resources.
	if strings.ContainsAny(value, "@\\") || strings.Contains(lower, "javascript:") || strings.Contains(lower, "expression(") {
		return false
	}

	for _, match := range cssURL.FindAllStringSubmatch(value, -1) {
		if !strings.HasPrefix(strings.Trim(strings.TrimSpace(match[1]), `"'`), "#") {
			return false
		}
	}

	return true
}

func localReference(value string) bool {
	if strings.HasPrefix(value, "#") {
		return true
	}

	// Some upstream SVGs include their original PNG artwork. Only inert,
	// embedded raster bytes are allowed; never an external or nested SVG URL.
	for _, prefix := range []string{"data:image/png;base64,", "data:image/jpeg;base64,"} {
		if strings.HasPrefix(value, prefix) {
			encoded := strings.Join(strings.Fields(strings.TrimPrefix(value, prefix)), "")
			_, err := base64.StdEncoding.DecodeString(encoded)

			return err == nil
		}
	}

	return false
}

func validateSVG(raw []byte) error {
	allowed := map[string]bool{
		"svg": true, "g": true, "path": true, "circle": true, "ellipse": true,
		"rect": true, "line": true, "polygon": true, "polyline": true,
		"defs": true, "title": true, "desc": true, "style": true,
		"linearGradient": true, "radialGradient": true, "stop": true,
		"clipPath": true, "mask": true, "pattern": true, "use": true, "image": true,
	}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	depth, roots := 0, 0
	inStyle := false
	var styleText strings.Builder

	for {
		token, err := decoder.Token()

		if err == io.EOF {
			if roots == 1 && depth == 0 {
				return nil
			}

			return errors.New("missing SVG root")
		}

		if err != nil {
			return err
		}

		switch token := token.(type) {
		case xml.StartElement:
			if inStyle {
				return errors.New("nested SVG style content")
			}

			if depth == 0 {
				roots++

				if roots != 1 || token.Name.Local != "svg" || token.Name.Space != "http://www.w3.org/2000/svg" {
					return errors.New("invalid SVG root")
				}
			}

			metadata := token.Name.Space == "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" && token.Name.Local == "namedview"

			if !metadata && (token.Name.Space != "http://www.w3.org/2000/svg" || !allowed[token.Name.Local]) {
				return errors.New("unsupported SVG element")
			}

			depth++
			inStyle = token.Name.Local == "style"

			for _, attr := range token.Attr {
				if strings.HasPrefix(strings.ToLower(attr.Name.Local), "on") || !internalCSS(attr.Value) {
					return errors.New("active SVG attribute")
				}

				if attr.Name.Local == "href" && !localReference(attr.Value) {
					return errors.New("external SVG reference")
				}
			}

		case xml.EndElement:
			if inStyle && !internalCSS(styleText.String()) {
				return errors.New("external SVG stylesheet resource")
			}

			depth--
			inStyle = false
			styleText.Reset()

		case xml.CharData:
			if inStyle {
				styleText.Write(token)
			}

			if depth == 0 && len(bytes.TrimSpace(token)) != 0 {
				return errors.New("unsupported SVG content")
			}

		case xml.Directive:
			return errors.New("SVG directives are not allowed")

		case xml.ProcInst:
			if token.Target != "xml" {
				return errors.New("SVG processing instructions are not allowed")
			}
		}
	}
}

func validateEntries(entries []entry) error {
	seen := map[string]bool{}
	total := 0

	for _, item := range entries {
		if item.Type != "blob" || !fileName.MatchString(item.Path) || seen[item.Path] || item.Size < 1 || item.Size > 256<<10 || len(item.SHA) != 40 {
			return errors.New("invalid logo tree entry")
		}

		if _, err := hex.DecodeString(item.SHA); err != nil {
			return errors.New("invalid logo blob hash")
		}

		seen[item.Path] = true
		total += item.Size
	}

	if len(entries) > 200 || total > 4<<20 || !seen["default.svg"] || !seen["default.light.svg"] || !seen["unknown.svg"] || !seen["unknown.light.svg"] {
		return errors.New("incomplete or oversized logo tree")
	}

	return nil
}

func downloadLogos(ctx context.Context, client *http.Client, commit string, entries []entry) (map[string][]byte, error) {
	if err := validateEntries(entries); err != nil {
		return nil, err
	}

	files := map[string][]byte{}
	var lock sync.Mutex
	var wg sync.WaitGroup
	var downloadErr error
	jobs := make(chan entry)

	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for item := range jobs {
				raw, err := fetch(ctx, client, "https://raw.githubusercontent.com/mempool/mining-pool-logos/"+commit+"/"+item.Path)

				if err == nil {
					blob := sha1.New()
					fmt.Fprintf(blob, "blob %d\x00", len(raw))
					blob.Write(raw)

					if len(raw) != item.Size || hex.EncodeToString(blob.Sum(nil)) != item.SHA {
						err = errors.New("logo does not match the pinned Git blob")
					} else {
						raw, err = prepareSVG(raw)
					}
				}

				lock.Lock()

				if err != nil {
					downloadErr = fmt.Errorf("%s: %w", item.Path, err)
				} else {
					files[item.Path] = raw
				}

				lock.Unlock()
			}
		}()
	}

	for _, item := range entries {
		jobs <- item
	}

	close(jobs)
	wg.Wait()

	return files, downloadErr
}

func writeSnapshot(path, commit string, files map[string][]byte) error {
	staging, err := os.MkdirTemp(filepath.Dir(path), ".pool-logos-update-*")

	if err != nil {
		return err
	}

	defer os.RemoveAll(staging)
	meta := source{URL: repository, Commit: commit, Files: map[string]string{}}

	for name, raw := range files {
		digest := sha256.Sum256(raw)
		meta.Files[name] = hex.EncodeToString(digest[:])

		if err := os.WriteFile(filepath.Join(staging, name), raw, 0644); err != nil {
			return err
		}
	}

	raw, err := json.MarshalIndent(meta, "", "  ")

	if err != nil {
		return err
	}

	if err := os.WriteFile(filepath.Join(staging, "source.json"), append(raw, '\n'), 0644); err != nil {
		return err
	}

	notice := "Mining pool logos\n\nSource: " + repository + "\nRevision: " + commit + "\n\nOriginal upstream artwork. Standard external SVG DTD declarations are removed;\nline endings and trailing whitespace are normalized. Names and artwork belong\nto their respective pool owners. The upstream repository does not declare a\nlicense; these assets are not covered by Nodarium's MIT license. No endorsement\nis implied.\n"

	if err := os.WriteFile(filepath.Join(staging, "NOTICE.txt"), []byte(notice), 0644); err != nil {
		return err
	}

	if err := os.Chmod(staging, 0755); err != nil {
		return err
	}

	// Stage everything first, then replace the whole directory so obsolete
	// assets disappear. Restore the previous snapshot if installation fails.
	backup := staging + "-previous"
	err = os.Rename(path, backup)
	existed := err == nil

	if err != nil && !os.IsNotExist(err) {
		return err
	}

	if err := os.Rename(staging, path); err != nil {
		if existed {
			if restoreErr := os.Rename(backup, path); restoreErr != nil {
				return fmt.Errorf("install failed: %v; restore failed: %w", err, restoreErr)
			}
		}

		return err
	}

	return os.RemoveAll(backup)
}

func update(ref string) error {
	if !revisionName.MatchString(ref) {
		return errors.New("invalid upstream revision")
	}

	if _, err := os.Stat("web/src/assets"); err != nil {
		return errors.New("run from the Nodarium repository root")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	client := &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	raw, err := fetch(ctx, client, "https://api.github.com/repos/mempool/mining-pool-logos/commits/"+ref)

	if err != nil {
		return err
	}

	var revision struct {
		SHA string `json:"sha"`
	}

	if json.Unmarshal(raw, &revision) != nil || len(revision.SHA) != 40 {
		return errors.New("invalid upstream revision")
	}

	if _, err := hex.DecodeString(revision.SHA); err != nil {
		return errors.New("invalid upstream revision")
	}

	raw, err = fetch(ctx, client, "https://api.github.com/repos/mempool/mining-pool-logos/git/trees/"+revision.SHA)

	if err != nil {
		return err
	}

	var tree struct {
		Entries   []entry `json:"tree"`
		Truncated bool    `json:"truncated"`
	}

	if json.Unmarshal(raw, &tree) != nil || tree.Truncated {
		return errors.New("invalid upstream logo tree")
	}

	var entries []entry

	for _, item := range tree.Entries {
		if strings.HasSuffix(item.Path, ".svg") {
			entries = append(entries, item)
		}
	}

	files, err := downloadLogos(ctx, client, revision.SHA, entries)

	if err != nil {
		return err
	}

	if err := writeSnapshot(assetDir, revision.SHA, files); err != nil {
		return err
	}

	fmt.Printf("Updated %d pool logos to %s. Rebuild Nodarium to use them.\n", len(files), revision.SHA)

	return nil
}

func main() {
	ref := flag.String("ref", "master", "upstream branch or commit to snapshot")
	flag.Parse()

	if err := update(*ref); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
