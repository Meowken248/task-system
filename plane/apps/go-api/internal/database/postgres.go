package database

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"
)

type Checker struct {
	address string
}

func NewChecker(databaseURL string) (*Checker, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return nil, fmt.Errorf("DATABASE_URL must use postgres or postgresql scheme")
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, fmt.Errorf("DATABASE_URL host is required")
	}
	port := parsed.Port()
	if port == "" {
		port = "5432"
	}
	return &Checker{address: net.JoinHostPort(host, port)}, nil
}

func (c *Checker) PingContext(ctx context.Context) error {
	if c == nil || strings.TrimSpace(c.address) == "" {
		return fmt.Errorf("postgres address is not configured")
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", c.address)
	if err != nil {
		return fmt.Errorf("connect postgres: %w", err)
	}
	return conn.Close()
}
