package web

import (
	"embed"
	"io/fs"
)

// Build the frontend with pnpm --dir web build before building Go.
//
//go:embed all:dist
var assets embed.FS

func Assets() fs.FS {
	f, err := fs.Sub(assets, "dist")

	if err != nil {
		panic(err)
	}

	return f
}
