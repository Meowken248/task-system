package sticky

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized  = errors.New("authentication required")
	ErrForbidden     = errors.New("workspace access denied")
	ErrNotFound      = errors.New("sticky not found")
	ErrInvalid       = errors.New("invalid sticky")
	ErrInvalidHTML   = errors.New("invalid html content")
	ErrInvalidBinary = errors.New("invalid binary data")
)

const maxBinarySize = 10 * 1024 * 1024

type Item struct {
	ID                  string          `json:"id"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
	CreatedBy           *string         `json:"created_by"`
	UpdatedBy           *string         `json:"updated_by"`
	DeletedAt           *time.Time      `json:"deleted_at"`
	Name                *string         `json:"name"`
	Description         json.RawMessage `json:"description"`
	DescriptionHTML     string          `json:"description_html"`
	DescriptionStripped *string         `json:"description_stripped"`
	DescriptionBinary   []byte          `json:"description_binary"`
	LogoProps           json.RawMessage `json:"logo_props"`
	Color               *string         `json:"color"`
	BackgroundColor     *string         `json:"background_color"`
	Workspace           string          `json:"workspace"`
	Owner               string          `json:"owner"`
	SortOrder           float64         `json:"sort_order"`
}

type Page struct {
	GroupedBy       any    `json:"grouped_by"`
	SubGroupedBy    any    `json:"sub_grouped_by"`
	TotalCount      int    `json:"total_count"`
	NextCursor      string `json:"next_cursor"`
	PrevCursor      string `json:"prev_cursor"`
	NextPageResults bool   `json:"next_page_results"`
	PrevPageResults bool   `json:"prev_page_results"`
	Count           int    `json:"count"`
	TotalPages      int    `json:"total_pages"`
	TotalResults    int    `json:"total_results"`
	ExtraStats      any    `json:"extra_stats"`
	Results         []Item `json:"results"`
}

type ListOptions struct {
	Query   string
	PerPage int
	Page    int
}

func parseListOptions(values url.Values) (ListOptions, error) {
	result := ListOptions{Query: values.Get("query"), PerPage: 20}
	if value := values.Get("per_page"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return result, errors.New("Invalid per_page parameter.")
		}
		if parsed > 1000 {
			return result, errors.New("Invalid per_page value. Cannot exceed 1000.")
		}
		result.PerPage = parsed
	}
	if result.PerPage <= 0 {
		return result, errors.New("Invalid per_page parameter.")
	}
	if cursor := values.Get("cursor"); cursor != "" {
		bits := strings.Split(cursor, ":")
		if len(bits) != 3 {
			return result, errors.New("Invalid cursor parameter.")
		}
		page, err := strconv.Atoi(bits[1])
		if err != nil || page < 0 {
			return result, errors.New("Invalid cursor parameter.")
		}
		if _, err = strconv.Atoi(bits[0]); err != nil {
			return result, errors.New("Invalid cursor parameter.")
		}
		if bits[2] != "0" && bits[2] != "1" {
			return result, errors.New("Invalid cursor parameter.")
		}
		result.Page = page
	}
	return result, nil
}

type WritePayload struct {
	Name              *string         `json:"name"`
	Description       json.RawMessage `json:"description"`
	DescriptionHTML   *string         `json:"description_html"`
	DescriptionBinary *string         `json:"description_binary"`
	LogoProps         json.RawMessage `json:"logo_props"`
	Color             *string         `json:"color"`
	BackgroundColor   *string         `json:"background_color"`
	SortOrder         *float64        `json:"sort_order"`
	present           map[string]bool
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

func (p WritePayload) has(field string) bool { return p.present[field] }

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

type identity struct{ UserID, WorkspaceID string }

func (s PostgreSQLStore) identity(ctx context.Context, sessionKey, slug string) (identity, error) {
	if s.Pool == nil {
		return identity{}, errors.New("database unavailable")
	}
	if sessionKey == "" {
		return identity{}, ErrUnauthorized
	}
	var result identity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=s.user_id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug).Scan(&result.UserID, &result.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return identity{}, checkErr
		}
		if valid {
			return identity{}, ErrForbidden
		}
		return identity{}, ErrUnauthorized
	}
	return result, err
}

const columns = `s.id::text, s.created_at, s.updated_at, s.created_by_id::text, s.updated_by_id::text,
	s.deleted_at, s.name, s.description, s.description_html, s.description_stripped, s.description_binary,
	s.logo_props, s.color, s.background_color, s.workspace_id::text, s.owner_id::text, s.sort_order`

type rowScanner interface{ Scan(...any) error }

func scanItem(row rowScanner) (Item, error) {
	var item Item
	var description, logo []byte
	err := row.Scan(&item.ID, &item.CreatedAt, &item.UpdatedAt, &item.CreatedBy, &item.UpdatedBy,
		&item.DeletedAt, &item.Name, &description, &item.DescriptionHTML, &item.DescriptionStripped,
		&item.DescriptionBinary, &logo, &item.Color, &item.BackgroundColor, &item.Workspace, &item.Owner, &item.SortOrder)
	if err != nil {
		return Item{}, err
	}
	item.Description = normalizeJSONBytes(description)
	item.LogoProps = normalizeJSONBytes(logo)
	return item, nil
}

func normalizeJSONBytes(value []byte) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(value)
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string, options ListOptions) (Page, error) {
	id, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return Page{}, err
	}
	filter := ""
	args := []any{id.WorkspaceID, id.UserID}
	if options.Query != "" {
		filter = " AND s.description_stripped ILIKE $3"
		args = append(args, "%"+options.Query+"%")
	}
	var total int
	if err = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM stickies s WHERE s.workspace_id::text=$1 AND s.owner_id::text=$2 AND s.deleted_at IS NULL`+filter, args...).Scan(&total); err != nil {
		return Page{}, err
	}
	limitIndex := len(args) + 1
	offsetIndex := len(args) + 2
	args = append(args, options.PerPage+1, options.Page*options.PerPage)
	rows, err := s.Pool.Query(ctx, `SELECT `+columns+` FROM stickies s
		WHERE s.workspace_id::text=$1 AND s.owner_id::text=$2 AND s.deleted_at IS NULL`+filter+
		` ORDER BY s.created_at DESC LIMIT $`+strconv.Itoa(limitIndex)+` OFFSET $`+strconv.Itoa(offsetIndex), args...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	items := make([]Item, 0, options.PerPage)
	for rows.Next() {
		item, scanErr := scanItem(rows)
		if scanErr != nil {
			return Page{}, scanErr
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page{}, err
	}
	hasNext := len(items) > options.PerPage
	if hasNext {
		items = items[:options.PerPage]
	}
	totalPages := (total + options.PerPage - 1) / options.PerPage
	return Page{
		TotalCount: total, NextCursor: fmt.Sprintf("%d:%d:0", options.PerPage, options.Page+1),
		PrevCursor: fmt.Sprintf("%d:%d:1", options.PerPage, options.Page-1), NextPageResults: hasNext,
		PrevPageResults: options.Page > 0, Count: len(items), TotalPages: totalPages, TotalResults: total, Results: items,
	}, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, stickyID string) (Item, error) {
	id, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return Item{}, err
	}
	item, err := scanItem(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM stickies s
		WHERE s.id::text=$1 AND s.workspace_id::text=$2 AND s.owner_id::text=$3 AND s.deleted_at IS NULL`, stickyID, id.WorkspaceID, id.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug string, input WritePayload) (Item, error) {
	id, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return Item{}, err
	}
	description, htmlValue, binary, logo, stripped, err := validatedValues(input, false, Item{})
	if err != nil {
		return Item{}, err
	}
	var sortOrder float64 = 65535
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else {
		var maximum *float64
		if err = s.Pool.QueryRow(ctx, `SELECT MAX(sort_order) FROM stickies WHERE workspace_id::text=$1 AND deleted_at IS NULL`, id.WorkspaceID).Scan(&maximum); err != nil {
			return Item{}, err
		}
		if maximum != nil {
			sortOrder = *maximum + 10000
		}
	}
	stickyID := uuid.NewString()
	_, err = s.Pool.Exec(ctx, `INSERT INTO stickies
		(id, created_at, updated_at, created_by_id, updated_by_id, deleted_at, name, description,
		description_html, description_stripped, description_binary, logo_props, color, background_color,
		workspace_id, owner_id, sort_order)
		VALUES ($1,NOW(),NOW(),$2::uuid,NULL,NULL,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10,$11::uuid,$2::uuid,$12)`,
		stickyID, id.UserID, input.Name, string(description), htmlValue, stripped, binary, string(logo),
		input.Color, input.BackgroundColor, id.WorkspaceID, sortOrder)
	if err != nil {
		return Item{}, err
	}
	return s.GetForSession(ctx, sessionKey, slug, stickyID)
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, stickyID string, input WritePayload) (Item, error) {
	current, err := s.GetForSession(ctx, sessionKey, slug, stickyID)
	if err != nil {
		return Item{}, err
	}
	id, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return Item{}, err
	}
	description, htmlValue, binary, logo, stripped, err := validatedValues(input, true, current)
	if err != nil {
		return Item{}, err
	}
	name, color, background, sortOrder := current.Name, current.Color, current.BackgroundColor, current.SortOrder
	if input.has("name") {
		name = input.Name
	}
	if input.has("color") {
		color = input.Color
	}
	if input.has("background_color") {
		background = input.BackgroundColor
	}
	if input.has("sort_order") && input.SortOrder != nil {
		sortOrder = *input.SortOrder
	}
	_, err = s.Pool.Exec(ctx, `UPDATE stickies SET name=$1, description=$2::jsonb, description_html=$3,
		description_stripped=$4, description_binary=$5, logo_props=$6::jsonb, color=$7, background_color=$8,
		sort_order=$9, updated_by_id=$10::uuid, updated_at=NOW()
		WHERE id::text=$11 AND workspace_id::text=$12 AND owner_id::text=$10 AND deleted_at IS NULL`,
		name, string(description), htmlValue, stripped, binary, string(logo), color, background, sortOrder,
		id.UserID, stickyID, id.WorkspaceID)
	if err != nil {
		return Item{}, err
	}
	return s.GetForSession(ctx, sessionKey, slug, stickyID)
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, stickyID string) error {
	id, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	result, err := s.Pool.Exec(ctx, `UPDATE stickies SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$1::uuid
		WHERE id::text=$2 AND workspace_id::text=$3 AND owner_id::text=$1 AND deleted_at IS NULL`, id.UserID, stickyID, id.WorkspaceID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func validatedValues(input WritePayload, partial bool, current Item) (json.RawMessage, string, []byte, json.RawMessage, *string, error) {
	description, logo := json.RawMessage(`{}`), json.RawMessage(`{}`)
	htmlValue := "<p></p>"
	var binary []byte
	if partial {
		description, logo, htmlValue, binary = current.Description, current.LogoProps, current.DescriptionHTML, current.DescriptionBinary
	}
	if input.has("description") {
		if len(input.Description) == 0 || string(input.Description) == "null" {
			description = json.RawMessage(`{}`)
		} else if !json.Valid(input.Description) {
			return nil, "", nil, nil, nil, ErrInvalid
		} else {
			description = input.Description
		}
	}
	if input.has("logo_props") {
		if len(input.LogoProps) == 0 || string(input.LogoProps) == "null" {
			logo = json.RawMessage(`{}`)
		} else if !json.Valid(input.LogoProps) {
			return nil, "", nil, nil, nil, ErrInvalid
		} else {
			logo = input.LogoProps
		}
	}
	if input.has("description_html") {
		if input.DescriptionHTML == nil {
			htmlValue = ""
		} else {
			htmlValue = *input.DescriptionHTML
			lower := strings.ToLower(htmlValue)
			if strings.Contains(lower, "<script") || strings.Contains(lower, "javascript:") || regexp.MustCompile(`(?i)\son[a-z]+\s*=`).MatchString(htmlValue) {
				return nil, "", nil, nil, nil, ErrInvalidHTML
			}
		}
	}
	if input.has("description_binary") {
		binary = nil
		if input.DescriptionBinary != nil && *input.DescriptionBinary != "" {
			decoded, err := base64.StdEncoding.DecodeString(*input.DescriptionBinary)
			if err != nil || len(decoded) < 4 || len(decoded) > maxBinarySize {
				return nil, "", nil, nil, nil, ErrInvalidBinary
			}
			prefix := strings.ToLower(string(decoded[:min(len(decoded), 200)]))
			for _, pattern := range []string{"<html", "<!doctype", "<script", "javascript:", "data:", "<iframe"} {
				if strings.Contains(prefix, pattern) {
					return nil, "", nil, nil, nil, ErrInvalidBinary
				}
			}
			binary = decoded
		}
	}
	var stripped *string
	if htmlValue != "" {
		value := html.UnescapeString(strings.TrimSpace(regexp.MustCompile(`<[^>]*>`).ReplaceAllString(htmlValue, "")))
		stripped = &value
	}
	return description, htmlValue, binary, logo, stripped, nil
}
