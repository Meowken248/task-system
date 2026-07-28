package issue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalid  = errors.New("invalid work item")
	ErrConflict = errors.New("work item conflict")
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
	ExternalID      *string         `json:"external_id"`
	ExternalSource  *string         `json:"external_source"`
	Assignees       []string        `json:"assignees"`
	AssigneeIDs     []string        `json:"assignee_ids"`
	Labels          []string        `json:"labels"`
	LabelIDs        []string        `json:"label_ids"`
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

type writeIdentity struct {
	UserID      string
	WorkspaceID string
	Role        int
}

func (s PostgreSQLStore) writeIdentity(ctx context.Context, sessionKey, slug, projectID string) (writeIdentity, error) {
	if s.Pool == nil {
		return writeIdentity{}, errors.New("work item database unavailable")
	}
	if sessionKey == "" {
		return writeIdentity{}, ErrUnauthorized
	}
	var identity writeIdentity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, pm.role
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).
		Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return writeIdentity{}, fmt.Errorf("check session: %w", checkErr)
		}
		if valid {
			return writeIdentity{}, ErrForbidden
		}
		return writeIdentity{}, ErrUnauthorized
	}
	return identity, err
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, input WritePayload) (Item, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Item{}, err
	}
	if identity.Role < 20 {
		return Item{}, ErrForbidden
	}
	name, err := validateCreatePayload(input)
	if err != nil {
		return Item{}, err
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

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, fmt.Errorf("begin create work item: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, projectID); err != nil {
		return Item{}, fmt.Errorf("lock work item sequence: %w", err)
	}
	stateID := cleanPointer(input.StateID)
	if stateID == nil {
		var selected string
		err = tx.QueryRow(ctx, `SELECT id::text FROM states WHERE project_id::text=$1 AND deleted_at IS NULL AND is_triage=FALSE ORDER BY "default" DESC, sequence ASC LIMIT 1`, projectID).Scan(&selected)
		if err != nil {
			return Item{}, fmt.Errorf("resolve default state: %w", err)
		}
		stateID = &selected
	} else if err = validateProjectReference(ctx, tx, "states", *stateID, projectID); err != nil {
		return Item{}, err
	}
	if input.ParentID != nil && strings.TrimSpace(*input.ParentID) != "" {
		if err = validateProjectReference(ctx, tx, "issues", strings.TrimSpace(*input.ParentID), projectID); err != nil {
			return Item{}, err
		}
	}
	if input.ExternalID != nil && input.ExternalSource != nil && strings.TrimSpace(*input.ExternalID) != "" && strings.TrimSpace(*input.ExternalSource) != "" {
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues WHERE project_id::text=$1 AND external_id=$2 AND external_source=$3 AND deleted_at IS NULL)`, projectID, *input.ExternalID, *input.ExternalSource).Scan(&exists)
		if err != nil {
			return Item{}, err
		}
		if exists {
			return Item{}, fmt.Errorf("%w: external id already exists", ErrConflict)
		}
	}

	issueID, sequenceID := newUUID(), 1
	if err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sequence), 0)+1 FROM issue_sequences WHERE project_id::text=$1`, projectID).Scan(&sequenceID); err != nil {
		return Item{}, fmt.Errorf("next work item sequence: %w", err)
	}
	var sortOrder float64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), 55535)+10000 FROM issues WHERE project_id::text=$1 AND state_id::text=$2 AND deleted_at IS NULL`, projectID, *stateID).Scan(&sortOrder); err != nil {
		return Item{}, fmt.Errorf("next work item order: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO issues
		(id, project_id, workspace_id, state_id, parent_id, name, description_json, description_html, description_stripped,
		priority, start_date, target_date, sequence_id, sort_order, estimate_point_id, type_id, external_id, external_source,
		is_draft, created_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10,$11,$12,$13,$14,NULLIF($15,''),NULLIF($16,''),$17,$18,FALSE,$19,NOW(),NOW())`,
		issueID, projectID, identity.WorkspaceID, *stateID, stringValue(input.ParentID), name, descriptionJSON,
		descriptionHTML, stripHTML(descriptionHTML), priority, startDate, targetDate, sequenceID, sortOrder,
		stringValue(input.EstimatePointID), stringValue(input.TypeID), input.ExternalID, input.ExternalSource, identity.UserID)
	if err != nil {
		return Item{}, fmt.Errorf("insert work item: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO issue_sequences
		(id, issue_id, sequence, project_id, workspace_id, deleted, created_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,FALSE,$6,NOW(),NOW())`, newUUID(), issueID, sequenceID, projectID, identity.WorkspaceID, identity.UserID)
	if err != nil {
		return Item{}, fmt.Errorf("insert work item sequence: %w", err)
	}
	if err = replaceRelations(ctx, tx, "issue_assignees", "assignee_id", issueID, projectID, identity, assignees); err != nil {
		return Item{}, err
	}
	if err = replaceRelations(ctx, tx, "issue_labels", "label_id", issueID, projectID, identity, labels); err != nil {
		return Item{}, err
	}
	if err = recordActivity(ctx, tx, issueID, projectID, identity, "created", "created the issue"); err != nil {
		return Item{}, err
	}
	item, err := scan(tx.QueryRow(ctx, `SELECT `+itemColumns+` FROM issues i JOIN states st ON st.id=i.state_id WHERE i.id::text=$1`, issueID))
	if err != nil {
		return Item{}, fmt.Errorf("read created work item: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Item{}, fmt.Errorf("commit work item: %w", err)
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, issueID string, input WritePayload) (Item, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Item{}, err
	}
	if issueID == "" {
		return Item{}, ErrNotFound
	}
	privileged := input.has("priority", "start_date", "target_date", "parent_id", "estimate_point_id", "type_id",
		"assignees", "assignee_ids", "labels", "label_ids")
	if privileged && identity.Role < 20 {
		return Item{}, ErrForbidden
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
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, issueID, projectID).Scan(&exists); err != nil {
		return Item{}, err
	}
	if !exists {
		return Item{}, ErrNotFound
	}
	if input.has("state_id") {
		if input.StateID == nil || strings.TrimSpace(*input.StateID) == "" {
			return Item{}, fmt.Errorf("%w: state_id cannot be empty", ErrInvalid)
		}
		if err = validateProjectReference(ctx, tx, "states", strings.TrimSpace(*input.StateID), projectID); err != nil {
			return Item{}, err
		}
	}
	if input.ParentID != nil && strings.TrimSpace(*input.ParentID) != "" {
		if strings.TrimSpace(*input.ParentID) == issueID {
			return Item{}, fmt.Errorf("%w: work item cannot be its own parent", ErrInvalid)
		}
		if err = validateProjectReference(ctx, tx, "issues", strings.TrimSpace(*input.ParentID), projectID); err != nil {
			return Item{}, err
		}
	}
	startDate, err := parseDate(input.StartDate)
	if err != nil {
		return Item{}, err
	}
	targetDate, err := parseDate(input.TargetDate)
	if err != nil {
		return Item{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE issues SET
		name=CASE WHEN $3 THEN $4 ELSE name END,
		description_html=CASE WHEN $5 THEN $6 ELSE description_html END,
		description_stripped=CASE WHEN $5 THEN $7 ELSE description_stripped END,
		description_json=CASE WHEN $8 THEN $9 ELSE description_json END,
		state_id=CASE WHEN $10 THEN NULLIF($11,'')::uuid ELSE state_id END,
		priority=CASE WHEN $12 THEN $13 ELSE priority END,
		start_date=CASE WHEN $14 THEN $15 ELSE start_date END,
		target_date=CASE WHEN $16 THEN $17 ELSE target_date END,
		parent_id=CASE WHEN $18 THEN NULLIF($19,'')::uuid ELSE parent_id END,
		estimate_point_id=CASE WHEN $20 THEN NULLIF($21,'')::uuid ELSE estimate_point_id END,
		type_id=CASE WHEN $22 THEN NULLIF($23,'')::uuid ELSE type_id END,
		updated_by_id=$24, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`, issueID, projectID,
		input.has("name"), valueOr(input.Name, ""), input.has("description_html"), valueOr(input.DescriptionHTML, ""), stripHTML(valueOr(input.DescriptionHTML, "")),
		input.has("description_json"), normalizedJSON(input.DescriptionJSON), input.has("state_id"), stringValue(input.StateID),
		input.has("priority"), valueOr(input.Priority, "none"), input.has("start_date"), startDate, input.has("target_date"), targetDate,
		input.has("parent_id"), stringValue(input.ParentID), input.has("estimate_point_id"), stringValue(input.EstimatePointID),
		input.has("type_id"), stringValue(input.TypeID), identity.UserID)
	if err != nil {
		return Item{}, fmt.Errorf("update work item: %w", err)
	}
	if input.has("assignees", "assignee_ids") {
		if err = replaceRelations(ctx, tx, "issue_assignees", "assignee_id", issueID, projectID, identity, firstNonNil(input.Assignees, input.AssigneeIDs)); err != nil {
			return Item{}, err
		}
	}
	if input.has("labels", "label_ids") {
		if err = replaceRelations(ctx, tx, "issue_labels", "label_id", issueID, projectID, identity, firstNonNil(input.Labels, input.LabelIDs)); err != nil {
			return Item{}, err
		}
	}
	if err = recordActivity(ctx, tx, issueID, projectID, identity, "updated", "updated the issue"); err != nil {
		return Item{}, err
	}
	item, err := scan(tx.QueryRow(ctx, `SELECT `+itemColumns+` FROM issues i JOIN states st ON st.id=i.state_id WHERE i.id::text=$1`, issueID))
	if err != nil {
		return Item{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, issueID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	var creatorID string
	err = s.Pool.QueryRow(ctx, `SELECT COALESCE(created_by_id::text,'') FROM issues WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`, issueID, projectID).Scan(&creatorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if identity.Role < 20 && creatorID != identity.UserID {
		return ErrForbidden
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE issues SET parent_id=NULL, updated_at=NOW() WHERE parent_id::text=$1 AND deleted_at IS NULL`, issueID); err != nil {
		return fmt.Errorf("detach child work items: %w", err)
	}
	result, err := tx.Exec(ctx, `UPDATE issues SET deleted_at=NOW(), updated_by_id=$3, updated_at=NOW() WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`, issueID, projectID, identity.UserID)
	if err != nil {
		return fmt.Errorf("delete work item: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err = recordActivity(ctx, tx, issueID, projectID, identity, "deleted", "deleted the issue"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func validateCreatePayload(input WritePayload) (string, error) {
	if input.Name == nil || strings.TrimSpace(*input.Name) == "" {
		return "", fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if len([]rune(strings.TrimSpace(*input.Name))) > 255 {
		return "", fmt.Errorf("%w: name is too long", ErrInvalid)
	}
	if !validPriority(valueOr(input.Priority, "none")) {
		return "", fmt.Errorf("%w: invalid priority", ErrInvalid)
	}
	return strings.TrimSpace(*input.Name), nil
}

func validPriority(value string) bool {
	switch value {
	case "none", "low", "medium", "high", "urgent":
		return true
	default:
		return false
	}
}

func parseDate(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", strings.TrimSpace(*value))
	if err != nil {
		return nil, fmt.Errorf("%w: date must use YYYY-MM-DD", ErrInvalid)
	}
	return &parsed, nil
}

func validateProjectReference(ctx context.Context, tx pgx.Tx, table, id, projectID string) error {
	allowed := map[string]bool{"states": true, "issues": true}
	if !allowed[table] {
		return fmt.Errorf("%w: invalid reference", ErrInvalid)
	}
	var exists bool
	query := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, table)
	if err := tx.QueryRow(ctx, query, id, projectID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: referenced %s does not exist", ErrInvalid, strings.TrimSuffix(table, "s"))
	}
	return nil
}

func replaceRelations(ctx context.Context, tx pgx.Tx, table, column, issueID, projectID string, identity writeIdentity, ids []string) error {
	allowed := map[string]string{"issue_assignees": "assignee_id", "issue_labels": "label_id"}
	if allowed[table] != column {
		return fmt.Errorf("invalid work item relation")
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$2 WHERE issue_id::text=$1 AND deleted_at IS NULL`, table), issueID, identity.UserID); err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	for _, id := range uniqueNonEmpty(ids) {
		if table == "issue_assignees" {
			var valid bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_members WHERE project_id::text=$1 AND member_id::text=$2 AND role>=15 AND is_active=TRUE AND deleted_at IS NULL)`, projectID, id).Scan(&valid); err != nil {
				return err
			}
			if !valid {
				continue
			}
		} else {
			var valid bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM labels WHERE project_id::text=$1 AND id::text=$2 AND deleted_at IS NULL)`, projectID, id).Scan(&valid); err != nil {
				return err
			}
			if !valid {
				continue
			}
		}
		query := fmt.Sprintf(`INSERT INTO %s (id, issue_id, %s, project_id, workspace_id, created_by_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`, table, column)
		if _, err := tx.Exec(ctx, query, newUUID(), issueID, id, projectID, identity.WorkspaceID, identity.UserID); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

func recordActivity(ctx context.Context, tx pgx.Tx, issueID, projectID string, identity writeIdentity, verb, comment string) error {
	_, err := tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch, project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'{}'::text[],$5,$6,$7,$8,$5,NOW(),NOW())`,
		newUUID(), issueID, verb, comment, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return fmt.Errorf("record work item activity: %w", err)
	}
	return nil
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func normalizedJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return `{}`
	}
	return string(raw)
}

func stripHTML(value string) string { return strings.TrimSpace(tagPattern.ReplaceAllString(value, "")) }
func valueOr(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}
func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
func cleanPointer(value *string) *string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	clean := strings.TrimSpace(*value)
	return &clean
}
func firstNonNil(first, second []string) []string {
	if first != nil {
		return first
	}
	return second
}
func uniqueNonEmpty(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
