package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type Local struct {
	BaseDir string
	BaseURL string
}

func (l *Local) Upload(ctx context.Context, key string, data io.Reader, size int64, contentType string) (string, error) {
	fullPath := filepath.Join(l.BaseDir, key)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return "", fmt.Errorf("create dir: %w", err)
	}
	f, err := os.OpenFile(fullPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, data); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}
	return l.GetURL(key), nil
}

func (l *Local) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	fullPath := filepath.Join(l.BaseDir, key)
	f, err := os.Open(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("not found: %s", key)
		}
		return nil, fmt.Errorf("open file: %w", err)
	}
	return f, nil
}

func (l *Local) Delete(ctx context.Context, key string) error {
	fullPath := filepath.Join(l.BaseDir, key)
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove file: %w", err)
	}
	return nil
}

func (l *Local) GetURL(key string) string {
	// For local storage, we will stream the file via our own API endpoints
	// such as /api/assets/v2/...
	return key
}

func (l *Local) GeneratePresignedPost(ctx context.Context, objectName string, fileType string, fileSize int64) (map[string]any, error) {
	return nil, fmt.Errorf("GeneratePresignedPost not supported for local storage")
}
