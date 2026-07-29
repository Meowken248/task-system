package storage

import (
	"context"
	"io"
)

type Provider interface {
	Upload(ctx context.Context, key string, data io.Reader, size int64, contentType string) (string, error)
	Download(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	GetURL(key string) string
}
