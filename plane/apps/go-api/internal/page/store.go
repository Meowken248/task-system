package page

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("page not found")
	ErrInvalid      = errors.New("invalid page")
	ErrLocked       = errors.New("page is locked")
)

type Item struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	OwnedBy         string          `json:"owned_by"`
	Access          int             `json:"access"`
	Color           string          `json:"color"`
	Parent          *string         `json:"parent"`
	IsFavorite      bool            `json:"is_favorite"`
	IsLocked        bool            `json:"is_locked"`
	ArchivedAt      *time.Time      `json:"archived_at"`
	Workspace       string          `json:"workspace"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	CreatedBy       *string         `json:"created_by"`
	UpdatedBy       *string         `json:"updated_by"`
	ViewProps       json.RawMessage `json:"view_props"`
	LogoProps       json.RawMessage `json:"logo_props"`
	LabelIDs        []string        `json:"label_ids"`
	ProjectIDs      []string        `json:"project_ids"`
	DescriptionHTML string          `json:"description_html,omitempty"`
	IssueIDs        []string        `json:"issue_ids,omitempty"`
}
type Summary struct {
	PublicPages   int `json:"public_pages"`
	PrivatePages  int `json:"private_pages"`
	ArchivedPages int `json:"archived_pages"`
}
type WritePayload struct {
	Name              *string         `json:"name"`
	Access            *int            `json:"access"`
	Color             *string         `json:"color"`
	Parent            *string         `json:"parent"`
	IsLocked          *bool           `json:"is_locked"`
	ViewProps         json.RawMessage `json:"view_props"`
	LogoProps         json.RawMessage `json:"logo_props"`
	Labels            []string        `json:"labels"`
	DescriptionJSON   json.RawMessage `json:"description_json"`
	DescriptionBinary *string         `json:"description_binary"`
	DescriptionHTML   *string         `json:"description_html"`
	present           map[string]bool
}

func (p *WritePayload) UnmarshalJSON(data []byte) error {
	type plain WritePayload
	var v plain
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = WritePayload(v)
	p.present = map[string]bool{}
	for k := range fields {
		p.present[k] = true
	}
	return nil
}
func (p WritePayload) has(k string) bool { return p.present[k] }

type identity struct {
	UserID, WorkspaceID, ProjectID string
	Role                           int
	GuestViewAll                   bool
}
type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) identity(ctx context.Context, session, slug, projectID string) (identity, error) {
	if s.Pool == nil {
		return identity{}, errors.New("database unavailable")
	}
	if session == "" {
		return identity{}, ErrUnauthorized
	}
	var id identity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id,w.id::text,pm.role,p.guest_view_all_features FROM sessions s JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id AND pm.is_active=TRUE AND pm.deleted_at IS NULL WHERE s.session_key=$1 AND s.expire_date>NOW()`, session, slug, projectID).Scan(&id.UserID, &id.WorkspaceID, &id.Role, &id.GuestViewAll)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity{}, ErrForbidden
	}
	id.ProjectID = projectID
	return id, err
}

const cols = `p.id::text,p.name,p.owned_by_id::text,p.access,p.color,p.parent_id::text,EXISTS(SELECT 1 FROM user_favorites f WHERE f.user_id::text=$1 AND f.entity_type='page' AND f.entity_identifier::text=p.id::text AND f.deleted_at IS NULL),p.is_locked,p.archived_at,p.workspace_id::text,p.created_at,p.updated_at,p.created_by_id::text,p.updated_by_id::text,p.view_props,p.logo_props,p.description_html,COALESCE((SELECT array_agg(pl.label_id::text) FROM page_labels pl WHERE pl.page_id=p.id AND pl.deleted_at IS NULL),'{}'),COALESCE((SELECT array_agg(pp2.project_id::text) FROM project_pages pp2 WHERE pp2.page_id=p.id AND pp2.deleted_at IS NULL),'{}')`

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Item, error) {
	var x Item
	var view, logo []byte
	err := row.Scan(&x.ID, &x.Name, &x.OwnedBy, &x.Access, &x.Color, &x.Parent, &x.IsFavorite, &x.IsLocked, &x.ArchivedAt, &x.Workspace, &x.CreatedAt, &x.UpdatedAt, &x.CreatedBy, &x.UpdatedBy, &view, &logo, &x.DescriptionHTML, &x.LabelIDs, &x.ProjectIDs)
	x.ViewProps = raw(view, `{"full_width":false}`)
	x.LogoProps = raw(logo, `{}`)
	return x, err
}
func raw(b []byte, f string) json.RawMessage {
	if len(b) == 0 || !json.Valid(b) {
		return json.RawMessage(f)
	}
	return b
}
func baseWhere() string {
	return ` FROM pages p JOIN project_pages pp ON pp.page_id=p.id AND pp.project_id::text=$3 AND pp.deleted_at IS NULL WHERE p.workspace_id::text=$2 AND p.deleted_at IS NULL`
}

func (s PostgreSQLStore) List(ctx context.Context, session, slug, projectID string) ([]Item, error) {
	id, e := s.identity(ctx, session, slug, projectID)
	if e != nil {
		return nil, e
	}
	q := `SELECT ` + cols + baseWhere() + ` AND p.parent_id IS NULL AND (p.owned_by_id::text=$1 OR p.access=0)`
	if id.Role == 5 && !id.GuestViewAll {
		q += ` AND p.owned_by_id::text=$1`
	}
	q += ` ORDER BY 7 DESC,p.created_at DESC`
	rows, e := s.Pool.Query(ctx, q, id.UserID, id.WorkspaceID, id.ProjectID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		x, se := scan(rows)
		if se != nil {
			return nil, se
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s PostgreSQLStore) Summary(ctx context.Context, session, slug, projectID string) (Summary, error) {
	id, e := s.identity(ctx, session, slug, projectID)
	if e != nil {
		return Summary{}, e
	}
	var out Summary
	e = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FILTER(WHERE p.access=0 AND p.archived_at IS NULL),COUNT(*) FILTER(WHERE p.access=1 AND p.archived_at IS NULL),COUNT(*) FILTER(WHERE p.archived_at IS NOT NULL)`+baseWhere()+` AND p.parent_id IS NULL AND (p.owned_by_id::text=$1 OR p.access=0)`, id.UserID, id.WorkspaceID, id.ProjectID).Scan(&out.PublicPages, &out.PrivatePages, &out.ArchivedPages)
	return out, e
}
func (s PostgreSQLStore) Get(ctx context.Context, session, slug, projectID, pageID string) (Item, error) {
	id, e := s.identity(ctx, session, slug, projectID)
	if e != nil {
		return Item{}, e
	}
	x, e := scan(s.Pool.QueryRow(ctx, `SELECT `+cols+baseWhere()+` AND p.id::text=$4 AND (p.owned_by_id::text=$1 OR p.access=0)`, id.UserID, id.WorkspaceID, id.ProjectID, pageID))
	if errors.Is(e, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if e == nil {
		rows, re := s.Pool.Query(ctx, `SELECT entity_identifier::text FROM page_logs WHERE page_id::text=$1 AND entity_name='issue' AND deleted_at IS NULL`, pageID)
		if re == nil {
			defer rows.Close()
			for rows.Next() {
				var v string
				if rows.Scan(&v) == nil {
					x.IssueIDs = append(x.IssueIDs, v)
				}
			}
		}
	}
	return x, e
}

func (s PostgreSQLStore) Create(ctx context.Context, session, slug, projectID string, in WritePayload) (Item, error) {
	id, e := s.identity(ctx, session, slug, projectID)
	if e != nil {
		return Item{}, e
	}
	if id.Role < 15 {
		return Item{}, ErrForbidden
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Item{}, e
	}
	defer tx.Rollback(ctx)
	pid := uuid()
	name, color, html := "", "", "<p></p>"
	access := 0
	view, logo, desc := `{"full_width":false}`, `{}`, `{}`
	if in.Name != nil {
		name = *in.Name
	}
	if in.Color != nil {
		color = *in.Color
	}
	if in.Access != nil {
		access = *in.Access
	}
	if in.DescriptionHTML != nil {
		html = *in.DescriptionHTML
	}
	if len(in.ViewProps) > 0 {
		view = string(in.ViewProps)
	}
	if len(in.LogoProps) > 0 {
		logo = string(in.LogoProps)
	}
	if len(in.DescriptionJSON) > 0 {
		desc = string(in.DescriptionJSON)
	}
	binary, e := decodeBinary(in.DescriptionBinary)
	if e != nil {
		return Item{}, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO pages(id,workspace_id,name,description_json,description_binary,description_html,description_stripped,owned_by_id,access,color,parent_id,is_locked,view_props,logo_props,is_global,sort_order,created_by_id,updated_by_id,created_at,updated_at) VALUES($1,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,$9,$10,NULLIF($11,'')::uuid,FALSE,$12,$13,FALSE,65535,$8::uuid,$8::uuid,NOW(),NOW())`, pid, id.WorkspaceID, name, desc, binary, html, strip(html), id.UserID, access, color, str(in.Parent), view, logo)
	if e != nil {
		return Item{}, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO project_pages(id,workspace_id,project_id,page_id,created_by_id,updated_by_id,created_at,updated_at) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$5::uuid,NOW(),NOW())`, uuid(), id.WorkspaceID, id.ProjectID, pid, id.UserID)
	if e != nil {
		return Item{}, e
	}
	if e = replaceLabels(ctx, tx, id, pid, in.Labels); e != nil {
		return Item{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Item{}, e
	}
	return s.Get(ctx, session, slug, projectID, pid)
}

func (s PostgreSQLStore) Update(ctx context.Context, session, slug, projectID, pageID string, in WritePayload) (Item, error) {
	id, err := s.identity(ctx, session, slug, projectID)
	if err != nil {
		return Item{}, err
	}
	if id.Role < 15 {
		return Item{}, ErrForbidden
	}
	var owner string
	var locked bool
	var currentAccess int
	err = s.Pool.QueryRow(ctx, `SELECT p.owned_by_id::text,p.is_locked,p.access`+baseWhere()+` AND p.id::text=$4`, id.UserID, id.WorkspaceID, id.ProjectID, pageID).Scan(&owner, &locked, &currentAccess)
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, err
	}
	if locked {
		return Item{}, ErrLocked
	}
	if in.Access != nil && *in.Access != currentAccess && owner != id.UserID {
		return Item{}, fmt.Errorf("%w: Access cannot be updated since this page is owned by someone else", ErrInvalid)
	}
	if in.Parent != nil && *in.Parent != "" {
		var exists bool
		if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pages p JOIN project_pages pp ON pp.page_id=p.id AND pp.project_id::text=$2 AND pp.deleted_at IS NULL WHERE p.id::text=$1 AND p.workspace_id::text=$3 AND p.deleted_at IS NULL)`, *in.Parent, projectID, id.WorkspaceID).Scan(&exists); err != nil || !exists {
			if err != nil {
				return Item{}, err
			}
			return Item{}, ErrNotFound
		}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)
	sets := []string{"updated_by_id=$1::uuid", "updated_at=NOW()"}
	args := []any{id.UserID, pageID}
	add := func(column string, value any, cast string) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s=$%d%s", column, len(args), cast))
	}
	if in.has("name") {
		add("name", str(in.Name), "")
	}
	if in.has("access") {
		add("access", intDefault(in.Access), "")
	}
	if in.has("color") {
		add("color", str(in.Color), "")
	}
	if in.has("parent") {
		add("parent_id", nullableString(in.Parent), "::uuid")
	}
	if in.has("view_props") {
		add("view_props", stringDefault(in.ViewProps, "{}"), "::jsonb")
	}
	if in.has("logo_props") {
		add("logo_props", stringDefault(in.LogoProps, "{}"), "::jsonb")
	}
	if in.has("description_html") {
		html := str(in.DescriptionHTML)
		add("description_html", html, "")
		add("description_stripped", strip(html), "")
	}
	if in.has("description_json") {
		add("description_json", stringDefault(in.DescriptionJSON, "{}"), "::jsonb")
	}
	if in.has("description_binary") {
		binary, decodeErr := decodeBinary(in.DescriptionBinary)
		if decodeErr != nil {
			return Item{}, decodeErr
		}
		add("description_binary", binary, "")
	}
	query := `UPDATE pages SET ` + strings.Join(sets, ",") + ` WHERE id::text=$2 AND deleted_at IS NULL`
	if _, err = tx.Exec(ctx, query, args...); err != nil {
		return Item{}, err
	}
	if in.has("labels") {
		if err = replaceLabels(ctx, tx, id, pageID, in.Labels); err != nil {
			return Item{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return s.Get(ctx, session, slug, projectID, pageID)
}

type BinaryPayload struct{ Data []byte }

type Version struct {
	ID                string          `json:"id"`
	Workspace         string          `json:"workspace"`
	Page              string          `json:"page"`
	LastSavedAt       time.Time       `json:"last_saved_at"`
	OwnedBy           string          `json:"owned_by"`
	DescriptionBinary []byte          `json:"description_binary,omitempty"`
	DescriptionHTML   string          `json:"description_html,omitempty"`
	DescriptionJSON   json.RawMessage `json:"description_json,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
	CreatedBy         *string         `json:"created_by"`
	UpdatedBy         *string         `json:"updated_by"`
}

func (s PostgreSQLStore) Action(ctx context.Context, session, slug, projectID, pageID, action string, in WritePayload) (any, error) {
	id, err := s.identity(ctx, session, slug, projectID)
	if err != nil {
		return nil, err
	}
	if action == "versions:GET" || action == "version:GET" {
		return s.versions(ctx, id, pageID, str(in.Parent))
	}
	var owner string
	var access int
	var locked bool
	var archivedAt *time.Time
	var parentID *string
	err = s.Pool.QueryRow(ctx, `SELECT p.owned_by_id::text,p.access,p.is_locked,p.archived_at,p.parent_id::text`+baseWhere()+` AND p.id::text=$4`, id.UserID, id.WorkspaceID, id.ProjectID, pageID).Scan(&owner, &access, &locked, &archivedAt, &parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	switch action {
	case "lock:POST", "lock:DELETE":
		if id.Role < 15 {
			return nil, ErrForbidden
		}
		_, err = s.Pool.Exec(ctx, `UPDATE pages SET is_locked=$1,updated_by_id=$2::uuid,updated_at=NOW() WHERE id::text=$3`, action == "lock:POST", id.UserID, pageID)
		return nil, err
	case "access:POST":
		if id.Role < 15 {
			return nil, ErrForbidden
		}
		requested := intDefault(in.Access)
		if requested != access && owner != id.UserID {
			return nil, fmt.Errorf("%w: Access cannot be updated since this page is owned by someone else", ErrInvalid)
		}
		_, err = s.Pool.Exec(ctx, `UPDATE pages SET access=$1,updated_by_id=$2::uuid,updated_at=NOW() WHERE id::text=$3`, requested, id.UserID, pageID)
		return nil, err
	case "favorite:POST":
		if id.Role < 15 {
			return nil, ErrForbidden
		}
		_, err = s.Pool.Exec(ctx, `INSERT INTO user_favorites(id,workspace_id,project_id,user_id,entity_type,entity_identifier,sequence,is_folder,metadata,created_by_id,updated_by_id,created_at,updated_at) VALUES($1,$2::uuid,$3::uuid,$4::uuid,'page',$5::uuid,65535,FALSE,'{}',$4::uuid,$4::uuid,NOW(),NOW())`, uuid(), id.WorkspaceID, projectID, id.UserID, pageID)
		return nil, err
	case "favorite:DELETE":
		if id.Role < 15 {
			return nil, ErrForbidden
		}
		result, execErr := s.Pool.Exec(ctx, `DELETE FROM user_favorites WHERE workspace_id::text=$1 AND project_id::text=$2 AND user_id::text=$3 AND entity_type='page' AND entity_identifier::text=$4`, id.WorkspaceID, projectID, id.UserID, pageID)
		if execErr == nil && result.RowsAffected() == 0 {
			return nil, ErrNotFound
		}
		return nil, execErr
	case "archive:POST", "archive:DELETE":
		if owner != id.UserID && id.Role < 20 {
			return nil, fmt.Errorf("%w: Only the owner or admin can archive the page", ErrInvalid)
		}
		tx, beginErr := s.Pool.Begin(ctx)
		if beginErr != nil {
			return nil, beginErr
		}
		defer tx.Rollback(ctx)
		if action == "archive:POST" {
			_, err = tx.Exec(ctx, `DELETE FROM user_favorites WHERE workspace_id::text=$1 AND project_id::text=$2 AND entity_type='page' AND entity_identifier::text=$3`, id.WorkspaceID, projectID, pageID)
			if err == nil {
				_, err = tx.Exec(ctx, `WITH RECURSIVE descendants AS (SELECT id FROM pages WHERE id::text=$1 UNION ALL SELECT p.id FROM pages p JOIN descendants d ON p.parent_id=d.id) UPDATE pages SET archived_at=NOW(),updated_at=NOW() WHERE id IN(SELECT id FROM descendants)`, pageID)
			}
			if err != nil {
				return nil, err
			}
			if err = tx.Commit(ctx); err != nil {
				return nil, err
			}
			return map[string]any{"archived_at": time.Now()}, nil
		}
		if parentID != nil {
			_, err = tx.Exec(ctx, `UPDATE pages SET parent_id=NULL WHERE id::text=$1 AND EXISTS(SELECT 1 FROM pages parent WHERE parent.id=pages.parent_id AND parent.archived_at IS NOT NULL)`, pageID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `WITH RECURSIVE descendants AS (SELECT id FROM pages WHERE id::text=$1 UNION ALL SELECT p.id FROM pages p JOIN descendants d ON p.parent_id=d.id) UPDATE pages SET archived_at=NULL,updated_at=NOW() WHERE id IN(SELECT id FROM descendants)`, pageID)
		}
		if err != nil {
			return nil, err
		}
		return nil, tx.Commit(ctx)
	case "description:GET":
		if owner != id.UserID && access != 0 {
			return nil, ErrForbidden
		}
		var data []byte
		err = s.Pool.QueryRow(ctx, `SELECT description_binary FROM pages WHERE id::text=$1 AND deleted_at IS NULL`, pageID).Scan(&data)
		return BinaryPayload{Data: data}, err
	case "description:PATCH":
		if owner != id.UserID && access != 0 {
			return nil, ErrForbidden
		}
		if locked {
			return nil, ErrLocked
		}
		if archivedAt != nil {
			return nil, fmt.Errorf("%w: PAGE_ARCHIVED", ErrInvalid)
		}
		return s.updateDescription(ctx, id, pageID, in)
	case "duplicate:POST":
		if access == 1 && owner != id.UserID {
			return nil, ErrForbidden
		}
		return s.duplicate(ctx, session, slug, projectID, id, pageID)
	case "delete:DELETE":
		if archivedAt == nil {
			return nil, fmt.Errorf("%w: The page should be archived before deleting", ErrInvalid)
		}
		if owner != id.UserID && id.Role < 20 {
			return nil, ErrForbidden
		}
		tx, beginErr := s.Pool.Begin(ctx)
		if beginErr != nil {
			return nil, beginErr
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, `UPDATE pages SET parent_id=NULL,updated_at=NOW() WHERE parent_id::text=$1 AND deleted_at IS NULL`, pageID); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `UPDATE pages SET deleted_at=NOW(),updated_at=NOW(),updated_by_id=$1::uuid WHERE id::text=$2`, id.UserID, pageID); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM user_favorites WHERE workspace_id::text=$1 AND project_id::text=$2 AND entity_type='page' AND entity_identifier::text=$3`, id.WorkspaceID, projectID, pageID); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM user_recent_visits WHERE workspace_id::text=$1 AND project_id::text=$2 AND entity_name='page' AND entity_identifier::text=$3`, id.WorkspaceID, projectID, pageID); err != nil {
			return nil, err
		}
		return nil, tx.Commit(ctx)
	default:
		return nil, ErrNotFound
	}
}

func (s PostgreSQLStore) updateDescription(ctx context.Context, id identity, pageID string, in WritePayload) (any, error) {
	binary, err := decodeBinary(in.DescriptionBinary)
	if err != nil {
		return nil, err
	}
	var oldHTML string
	if err = s.Pool.QueryRow(ctx, `SELECT description_html FROM pages WHERE id::text=$1`, pageID).Scan(&oldHTML); err != nil {
		return nil, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	versionID := uuid()
	_, err = tx.Exec(ctx, `INSERT INTO page_versions(id,workspace_id,page_id,last_saved_at,owned_by_id,description_binary,description_html,description_stripped,description_json,sub_pages_data,created_by_id,updated_by_id,created_at,updated_at) SELECT $1,workspace_id,id,NOW(),owned_by_id,description_binary,description_html,description_stripped,description_json,'{}',$2::uuid,$2::uuid,NOW(),NOW() FROM pages WHERE id::text=$3`, versionID, id.UserID, pageID)
	if err != nil {
		return nil, err
	}
	sets := []string{"updated_by_id=$1::uuid", "updated_at=NOW()"}
	args := []any{id.UserID, pageID}
	add := func(c string, v any, cast string) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s=$%d%s", c, len(args), cast))
	}
	if in.has("description_binary") {
		add("description_binary", binary, "")
	}
	if in.has("description_html") {
		html := str(in.DescriptionHTML)
		add("description_html", html, "")
		add("description_stripped", strip(html), "")
	}
	if in.has("description_json") {
		add("description_json", stringDefault(in.DescriptionJSON, "{}"), "::jsonb")
	}
	if _, err = tx.Exec(ctx, `UPDATE pages SET `+strings.Join(sets, ",")+` WHERE id::text=$2`, args...); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]string{"message": "Updated successfully"}, nil
}

func (s PostgreSQLStore) versions(ctx context.Context, id identity, pageID, versionID string) (any, error) {
	query := `SELECT id::text,workspace_id::text,page_id::text,last_saved_at,owned_by_id::text,description_binary,description_html,description_json,created_at,updated_at,created_by_id::text,updated_by_id::text FROM page_versions WHERE workspace_id::text=$1 AND page_id::text=$2 AND deleted_at IS NULL`
	args := []any{id.WorkspaceID, pageID}
	if versionID != "" {
		query += ` AND id::text=$3`
		args = append(args, versionID)
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		var v Version
		var rawJSON []byte
		if err = rows.Scan(&v.ID, &v.Workspace, &v.Page, &v.LastSavedAt, &v.OwnedBy, &v.DescriptionBinary, &v.DescriptionHTML, &rawJSON, &v.CreatedAt, &v.UpdatedAt, &v.CreatedBy, &v.UpdatedBy); err != nil {
			return nil, err
		}
		v.DescriptionJSON = raw(rawJSON, "{}")
		out = append(out, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if versionID != "" {
		if len(out) == 0 {
			return nil, ErrNotFound
		}
		return out[0], nil
	}
	for i := range out {
		out[i].DescriptionBinary = nil
		out[i].DescriptionHTML = ""
		out[i].DescriptionJSON = nil
	}
	return out, nil
}

func (s PostgreSQLStore) duplicate(ctx context.Context, session, slug, projectID string, id identity, pageID string) (Item, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)
	newID := uuid()
	_, err = tx.Exec(ctx, `INSERT INTO pages(id,workspace_id,name,description_json,description_binary,description_html,description_stripped,owned_by_id,access,color,parent_id,is_locked,view_props,logo_props,is_global,sort_order,created_by_id,updated_by_id,created_at,updated_at) SELECT $1,workspace_id,name||' (Copy)',description_json,NULL,description_html,description_stripped,$2::uuid,access,color,parent_id,is_locked,view_props,logo_props,is_global,sort_order,$2::uuid,$2::uuid,NOW(),NOW() FROM pages WHERE id::text=$3 AND deleted_at IS NULL`, newID, id.UserID, pageID)
	if err != nil {
		return Item{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO project_pages(id,workspace_id,project_id,page_id,created_by_id,updated_by_id,created_at,updated_at) SELECT md5(random()::text||clock_timestamp()::text)::uuid,workspace_id,project_id,$1::uuid,$2::uuid,$2::uuid,NOW(),NOW() FROM project_pages WHERE page_id::text=$3 AND deleted_at IS NULL`, newID, id.UserID, pageID)
	if err != nil {
		return Item{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return s.Get(ctx, session, slug, projectID, newID)
}

func replaceLabels(ctx context.Context, tx pgx.Tx, id identity, pageID string, labels []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM page_labels WHERE page_id::text=$1`, pageID); err != nil {
		return err
	}
	for _, labelID := range labels {
		if _, err := tx.Exec(ctx, `INSERT INTO page_labels(id,workspace_id,page_id,label_id,created_by_id,updated_by_id,created_at,updated_at) SELECT $1,$2::uuid,$3::uuid,l.id,$4::uuid,$4::uuid,NOW(),NOW() FROM labels l WHERE l.id::text=$5 AND l.project_id::text=$6 AND l.deleted_at IS NULL`, uuid(), id.WorkspaceID, pageID, id.UserID, labelID, id.ProjectID); err != nil {
			return err
		}
	}
	return nil
}
func decodeBinary(value *string) ([]byte, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	b, err := base64.StdEncoding.DecodeString(*value)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid description_binary", ErrInvalid)
	}
	return b, nil
}

var tagPattern = regexp.MustCompile(`<[^>]*>`)

func strip(value string) string { return strings.TrimSpace(tagPattern.ReplaceAllString(value, "")) }
func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
func str(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func nullableString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
func intDefault(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
func stringDefault(value json.RawMessage, fallback string) string {
	if len(value) == 0 || !json.Valid(value) {
		return fallback
	}
	return string(value)
}
