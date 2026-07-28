package database

import "testing"

func TestNewChecker(t *testing.T) {
	checker, err := NewChecker("postgresql://plane:plane@plane-db:5432/plane")
	if err != nil {
		t.Fatalf("NewChecker() error = %v", err)
	}
	if checker.address != "plane-db:5432" {
		t.Fatalf("address = %q", checker.address)
	}
}

func TestNewCheckerRejectsWrongScheme(t *testing.T) {
	if _, err := NewChecker("http://plane-db/plane"); err == nil {
		t.Fatal("expected scheme validation error")
	}
}
