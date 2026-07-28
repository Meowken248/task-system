package project

import (
	"strings"
	"testing"
)

func TestGetProjectByIDQueryUsesContiguousParameters(t *testing.T) {
	if !strings.Contains(getProjectByIDQuery, "p.id::text = $3") {
		t.Fatal("project detail query must use the third and final argument for project id")
	}
	if strings.Contains(getProjectByIDQuery, "$4") {
		t.Fatal("project detail query must not skip an unused third parameter")
	}
}

func TestCanAccessProjectMatchesListVisibility(t *testing.T) {
	tests := []struct {
		name                 string
		workspaceRole        int
		hasProjectMembership bool
		network              int
		want                 bool
	}{
		{name: "admin can open private project", workspaceRole: 20, network: 0, want: true},
		{name: "member can open joined private project", workspaceRole: 15, hasProjectMembership: true, network: 0, want: true},
		{name: "member can open public project without project membership", workspaceRole: 15, network: 2, want: true},
		{name: "member cannot open unjoined private project", workspaceRole: 15, network: 0, want: false},
		{name: "guest can open joined project", workspaceRole: 5, hasProjectMembership: true, network: 0, want: true},
		{name: "guest cannot open unjoined public project", workspaceRole: 5, network: 2, want: false},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			got := canAccessProject(testCase.workspaceRole, testCase.hasProjectMembership, testCase.network)
			if got != testCase.want {
				t.Fatalf("canAccessProject()=%v want=%v", got, testCase.want)
			}
		})
	}
}
