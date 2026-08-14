package draftissue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalid  = errors.New("invalid draft issue")
	ErrConflict = errors.New("draft issue conflict")
	tagPattern  = regexp.MustCompile(`<[^>]*>`)
	dangerHTML  = regexp.MustCompile(`(?i)<\s*(script|iframe|object|embed)|\son[a-z]+\s*=`)
)

type WritePayload struct {
	Name            *string         `json:"name"`
	DescriptionHTML *string         `json:"description_html"`
	DescriptionJSON json.RawMessage `json:"description_json"`
	StateID         *string         `json:"state_id"`
	Priority        *string         `json:"priority"`
	StartDate       *string         `json:"start_date"`
	TargetDate      *string         `json:"target_date"`
	ParentID        *string         `json:"parent_id"`
	EstimatePointID *string         `json:"estimate_point_id"`
	TypeID          *string         `json:"type_id"`
	Assignees       []string        `json:"assignees"`
	AssigneeIDs     []string        `json:"assignee_ids"`
	Labels          []string        `json:"labels"`
	LabelIDs        []string        `json:"label_ids"`
	ProjectID       *string         `json:"project_id"`
	ModuleIDs       []string        `json:"module_ids"`
	CycleID         *string         `json:"cycle_id"`
	present         map[string]bool
}

func (p *WritePayload) UnmarshalJSON(data []byte) error {
	type plain WritePayload
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = WritePayload(decoded)
	p.present = make(map[string]bool, len(fields))
	for field := range fields {
		p.present[field] = true
	}
	return nil
}

func (p WritePayload) has(fields ...string) bool {
	for _, field := range fields {
		if p.present[field] {
			return true
		}
	}
	return false
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug string, input WritePayload) (Item, error) {
	workspaceID, userID, err := s.authorizeAndGetUserID(ctx, sessionKey, slug)
	if err != nil {
		return Item{}, err
	}

	name := valueOr(input.Name, "")
	if strings.TrimSpace(name) == "" {
		name = "Draft Issue"
	}

	startDate, err := parseDate(input.StartDate)
	if err != nil {
		return Item{}, err
	}
	targetDate, err := parseDate(input.TargetDate)
	if err != nil || (startDate != nil && targetDate != nil && startDate.After(*targetDate)) {
		return Item{}, fmt.Errorf("%w: invalid date range", ErrInvalid)
	}

	priority := valueOr(input.Priority, "none")
	descriptionHTML := valueOr(input.DescriptionHTML, "<p></p>")
	if dangerHTML.MatchString(descriptionHTML) {
		return Item{}, fmt.Errorf("%w: unsafe description_html", ErrInvalid)
	}
	descriptionJSON := normalizedJSON(input.DescriptionJSON)
	assignees := firstNonNil(input.Assignees, input.AssigneeIDs)
	labels := firstNonNil(input.Labels, input.LabelIDs)
	moduleIDs := input.ModuleIDs
	cycleID := cleanPointer(input.CycleID)
	projectID := cleanPointer(input.ProjectID)

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, fmt.Errorf("begin create draft issue: %w", err)
	}
	defer tx.Rollback(ctx)

	stateID := cleanPointer(input.StateID)
	if stateID != nil && projectID != nil {
		if err = validateProjectReference(ctx, tx, "states", *stateID, *projectID); err != nil {
			return Item{}, err
		}
	}
	if input.ParentID != nil && projectID != nil && strings.TrimSpace(*input.ParentID) != "" {
		if err = validateProjectReference(ctx, tx, "issues", strings.TrimSpace(*input.ParentID), *projectID); err != nil {
			return Item{}, err
		}
	}

	draftID := uuid.New().String()
	sortOrder := float64(65535.0)

	_, err = tx.Exec(ctx, `INSERT INTO draft_issues
		(id, workspace_id, project_id, state_id, parent_id, name, description_json, description_html, description_stripped,
		priority, start_date, target_date, sort_order, estimate_point_id, type_id, created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,NULLIF($5,'')::uuid,$6,$7,$8,$9,$10,$11,$12,$13,
			NULLIF($14,'')::uuid,NULLIF($15,'')::uuid,$16,$16,NOW(),NOW())`,
		draftID, workspaceID, stringValue(projectID), stringValue(stateID), stringValue(input.ParentID), name, descriptionJSON,
		descriptionHTML, stripHTML(descriptionHTML), priority, startDate, targetDate, sortOrder,
		stringValue(input.EstimatePointID), stringValue(input.TypeID), userID)
	if err != nil {
		return Item{}, fmt.Errorf("insert draft issue: %w", err)
	}

	if err = replaceRelations(ctx, tx, "draft_issue_assignees", "assignee_id", draftID, workspaceID, userID, assignees); err != nil {
		return Item{}, err
	}
	if err = replaceRelations(ctx, tx, "draft_issue_labels", "label_id", draftID, workspaceID, userID, labels); err != nil {
		return Item{}, err
	}
	if cycleID != nil {
		if err = replaceRelations(ctx, tx, "draft_issue_cycles", "cycle_id", draftID, workspaceID, userID, []string{*cycleID}); err != nil {
			return Item{}, err
		}
	}
	if len(moduleIDs) > 0 {
		if err = replaceRelations(ctx, tx, "draft_issue_modules", "module_id", draftID, workspaceID, userID, moduleIDs); err != nil {
			return Item{}, err
		}
	}

	item, err := readItem(ctx, tx, draftID)
	if err != nil {
		return Item{}, fmt.Errorf("read created draft issue: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Item{}, fmt.Errorf("commit draft issue: %w", err)
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, draftID string, input WritePayload) (Item, error) {
	workspaceID, userID, err := s.authorizeAndGetUserID(ctx, sessionKey, slug)
	if err != nil {
		return Item{}, err
	}
	if draftID == "" {
		return Item{}, ErrNotFound
	}
	if input.has("name") && (input.Name == nil || strings.TrimSpace(*input.Name) == "") {
		return Item{}, fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if input.Priority != nil && !validPriority(*input.Priority) {
		return Item{}, fmt.Errorf("%w: invalid priority", ErrInvalid)
	}
	if input.DescriptionHTML != nil && dangerHTML.MatchString(*input.DescriptionHTML) {
		return Item{}, fmt.Errorf("%w: unsafe description_html", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM draft_issues WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL AND created_by_id::text=$3)`, draftID, workspaceID, userID).Scan(&exists); err != nil {
		return Item{}, err
	}
	if !exists {
		return Item{}, ErrNotFound
	}

	updates := []string{"updated_at=NOW()", "updated_by_id=$3"}
	args := []any{draftID, workspaceID, userID}
	argIdx := 4

	if input.has("name") {
		updates = append(updates, fmt.Sprintf("name=$%d", argIdx))
		args = append(args, *input.Name)
		argIdx++
	}
	if input.has("description_html") {
		updates = append(updates, fmt.Sprintf("description_html=$%d, description_stripped=$%d", argIdx, argIdx+1))
		args = append(args, *input.DescriptionHTML, stripHTML(*input.DescriptionHTML))
		argIdx += 2
	}
	if input.has("description_json") {
		updates = append(updates, fmt.Sprintf("description_json=$%d", argIdx))
		args = append(args, normalizedJSON(input.DescriptionJSON))
		argIdx++
	}
	if input.has("state_id") {
		updates = append(updates, fmt.Sprintf("state_id=NULLIF($%d, '')::uuid", argIdx))
		args = append(args, stringValue(input.StateID))
		argIdx++
	}
	if input.has("priority") {
		updates = append(updates, fmt.Sprintf("priority=$%d", argIdx))
		args = append(args, *input.Priority)
		argIdx++
	}
	if input.has("start_date") {
		sd, _ := parseDate(input.StartDate)
		updates = append(updates, fmt.Sprintf("start_date=$%d", argIdx))
		args = append(args, sd)
		argIdx++
	}
	if input.has("target_date") {
		td, _ := parseDate(input.TargetDate)
		updates = append(updates, fmt.Sprintf("target_date=$%d", argIdx))
		args = append(args, td)
		argIdx++
	}
	if input.has("parent_id") {
		updates = append(updates, fmt.Sprintf("parent_id=NULLIF($%d, '')::uuid", argIdx))
		args = append(args, stringValue(input.ParentID))
		argIdx++
	}
	if input.has("estimate_point_id") {
		updates = append(updates, fmt.Sprintf("estimate_point_id=NULLIF($%d, '')::uuid", argIdx))
		args = append(args, stringValue(input.EstimatePointID))
		argIdx++
	}
	if input.has("type_id") {
		updates = append(updates, fmt.Sprintf("type_id=NULLIF($%d, '')::uuid", argIdx))
		args = append(args, stringValue(input.TypeID))
		argIdx++
	}
	if input.has("project_id") {
		updates = append(updates, fmt.Sprintf("project_id=NULLIF($%d, '')::uuid", argIdx))
		args = append(args, stringValue(input.ProjectID))
		argIdx++
	}

	_, err = tx.Exec(ctx, `UPDATE draft_issues SET `+strings.Join(updates, ", ")+` WHERE id::text=$1 AND workspace_id::text=$2`, args...)
	if err != nil {
		return Item{}, fmt.Errorf("update draft issue: %w", err)
	}

	if input.has("assignees", "assignee_ids") {
		assignees := firstNonNil(input.Assignees, input.AssigneeIDs)
		if err = replaceRelations(ctx, tx, "draft_issue_assignees", "assignee_id", draftID, workspaceID, userID, assignees); err != nil {
			return Item{}, err
		}
	}
	if input.has("labels", "label_ids") {
		labels := firstNonNil(input.Labels, input.LabelIDs)
		if err = replaceRelations(ctx, tx, "draft_issue_labels", "label_id", draftID, workspaceID, userID, labels); err != nil {
			return Item{}, err
		}
	}
	if input.has("cycle_id") {
		var cycles []string
		if input.CycleID != nil && *input.CycleID != "" && *input.CycleID != "not_provided" {
			cycles = []string{*input.CycleID}
		}
		if err = replaceRelations(ctx, tx, "draft_issue_cycles", "cycle_id", draftID, workspaceID, userID, cycles); err != nil {
			return Item{}, err
		}
	}
	if input.has("module_ids") {
		if err = replaceRelations(ctx, tx, "draft_issue_modules", "module_id", draftID, workspaceID, userID, input.ModuleIDs); err != nil {
			return Item{}, err
		}
	}

	item, err := readItem(ctx, tx, draftID)
	if err != nil {
		return Item{}, fmt.Errorf("read updated draft issue: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Item{}, fmt.Errorf("commit update: %w", err)
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, draftID string) error {
	workspaceID, userID, err := s.authorizeAndGetUserID(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if draftID == "" {
		return ErrNotFound
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE draft_issues SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$3 
		WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL AND created_by_id::text=$3`, draftID, workspaceID, userID)
	if err != nil {
		return fmt.Errorf("delete draft issue: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Helpers

func replaceRelations(ctx context.Context, tx pgx.Tx, table, refCol, draftID, workspaceID, userID string, refs []string) error {
	if refs == nil {
		return nil
	}
	_, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET deleted_at=NOW(), updated_by_id=$3, updated_at=NOW() WHERE draft_issue_id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL`, table), draftID, workspaceID, userID)
	if err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	if len(refs) == 0 {
		return nil
	}
	var values []string
	var args []any
	args = append(args, draftID, workspaceID, userID)
	for i, ref := range refs {
		values = append(values, fmt.Sprintf("($1, $%d, $2, $3, $3, NOW(), NOW())", i+4))
		args = append(args, ref)
	}
	query := fmt.Sprintf(`INSERT INTO %s (draft_issue_id, %s, workspace_id, created_by_id, updated_by_id, created_at, updated_at) VALUES `, table, refCol) + strings.Join(values, ",") + ` ON CONFLICT (draft_issue_id, ` + refCol + `, deleted_at) DO UPDATE SET deleted_at=NULL, updated_at=NOW(), updated_by_id=$3`
	_, err = tx.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("insert %s: %w", table, err)
	}
	return nil
}

func readItem(ctx context.Context, tx pgx.Tx, id string) (Item, error) {
	var item Item
	err := tx.QueryRow(ctx, `SELECT id, name, description_html, sort_order, state_id::text, priority, project_id::text, parent_id::text, type_id::text, created_at, updated_at, start_date, target_date, completed_at, created_by_id::text, updated_by_id::text, estimate_point_id::text 
		FROM draft_issues WHERE id::text=$1`, id).Scan(
		&item.ID, &item.Name, &item.DescriptionHTML, &item.SortOrder, &item.StateID, &item.Priority, &item.ProjectID, &item.ParentID, &item.TypeID,
		&item.CreatedAt, &item.UpdatedAt, &item.StartDate, &item.TargetDate, &item.CompletedAt, &item.CreatedBy, &item.UpdatedBy, &item.EstimatePoint)
	if err != nil {
		return Item{}, err
	}
	
	// Query labels
	rows, err := tx.Query(ctx, `SELECT label_id::text FROM draft_issue_labels WHERE draft_issue_id::text=$1 AND deleted_at IS NULL`, id)
	if err == nil {
		for rows.Next() {
			var label string
			if rows.Scan(&label) == nil {
				item.LabelIDs = append(item.LabelIDs, label)
			}
		}
		rows.Close()
	}

	// Query assignees
	rows, err = tx.Query(ctx, `SELECT assignee_id::text FROM draft_issue_assignees WHERE draft_issue_id::text=$1 AND deleted_at IS NULL`, id)
	if err == nil {
		for rows.Next() {
			var assignee string
			if rows.Scan(&assignee) == nil {
				item.AssigneeIDs = append(item.AssigneeIDs, assignee)
			}
		}
		rows.Close()
	}

	// Query modules
	rows, err = tx.Query(ctx, `SELECT module_id::text FROM draft_issue_modules WHERE draft_issue_id::text=$1 AND deleted_at IS NULL`, id)
	if err == nil {
		for rows.Next() {
			var module string
			if rows.Scan(&module) == nil {
				item.ModuleIDs = append(item.ModuleIDs, module)
			}
		}
		rows.Close()
	}

	// Query cycles
	rows, err = tx.Query(ctx, `SELECT cycle_id::text FROM draft_issue_cycles WHERE draft_issue_id::text=$1 AND deleted_at IS NULL LIMIT 1`, id)
	if err == nil {
		for rows.Next() {
			var cycle string
			if rows.Scan(&cycle) == nil {
				item.CycleID = &cycle
			}
		}
		rows.Close()
	}

	if item.LabelIDs == nil { item.LabelIDs = []string{} }
	if item.AssigneeIDs == nil { item.AssigneeIDs = []string{} }
	if item.ModuleIDs == nil { item.ModuleIDs = []string{} }

	return item, nil
}

func parseDate(val *string) (*time.Time, error) {
	if val == nil || strings.TrimSpace(*val) == "" || *val == "null" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", *val)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid date format", ErrInvalid)
	}
	return &t, nil
}

func validPriority(p string) bool {
	p = strings.ToLower(p)
	return p == "urgent" || p == "high" || p == "medium" || p == "low" || p == "none"
}

func valueOr(p *string, def string) string {
	if p == nil || *p == "null" {
		return def
	}
	return *p
}

func stringValue(p *string) *string {
	if p == nil || *p == "" || *p == "null" {
		return nil
	}
	return p
}

func cleanPointer(p *string) *string {
	if p == nil {
		return nil
	}
	s := strings.TrimSpace(*p)
	if s == "" || strings.ToLower(s) == "null" {
		return nil
	}
	return &s
}

func firstNonNil(a, b []string) []string {
	if a != nil {
		return a
	}
	return b
}

func normalizedJSON(raw json.RawMessage) []byte {
	if len(raw) == 0 || string(raw) == "null" {
		return []byte("{}")
	}
	return raw
}

func stripHTML(html string) string {
	return strings.TrimSpace(tagPattern.ReplaceAllString(html, " "))
}

func validateProjectReference(ctx context.Context, tx pgx.Tx, table, id, projectID string) error {
	var exists bool
	err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, pgx.Identifier{table}.Sanitize()), id, projectID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("validate %s reference: %w", table, err)
	}
	if !exists {
		return fmt.Errorf("%w: invalid %s reference", ErrInvalid, table)
	}
	return nil
}
