package admin

import (
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

type importRow struct {
	Line     int      `json:"line"`
	Username string   `json:"username"`
	Name     string   `json:"name"`
	ID       string   `json:"id"`
	Phone    string   `json:"phone"`
	Groups   []string `json:"groups"`
	Error    string   `json:"error"`
	password string
}

type importRequest struct {
	CSV    string `json:"csv"`
	Commit bool   `json:"commit"`
}

func readRequest(c *gin.Context, target any, limit int64) bool {
	if c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
		errhandler.Fail(c, errhandler.CSRFValidationFailed)
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	d := json.NewDecoder(c.Request.Body)
	var extra any
	if d.Decode(target) != nil || d.Decode(&extra) != io.EOF {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return false
	}
	return true
}

// CreateUser shares import validation and account initialization with CSV uploads.
func (s *Service) CreateUser(c *gin.Context) {
	var req struct {
		Username string   `json:"username"`
		Name     string   `json:"name"`
		ID       string   `json:"id"`
		Phone    string   `json:"phone"`
		Password string   `json:"password"`
		Groups   []string `json:"groups"`
	}
	if !readRequest(c, &req, 8<<10) {
		return
	}
	groups := req.Groups
	if len(groups) == 0 {
		groups = []string{"formal_user"}
	}
	if _, ok := normalizeGroups(groups); !ok {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	var content strings.Builder
	w := csv.NewWriter(&content)
	if err := w.WriteAll([][]string{{"账号", "姓名", "学号", "初始密码", "用户组", "手机号"}, {req.Username, req.Name, req.ID, req.Password, strings.Join(groups, "|"), req.Phone}}); err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	s.importUsers(c, importRequest{CSV: content.String(), Commit: true})
}

// ImportUsers validates the entire file again at commit and never overwrites accounts.
func (s *Service) ImportUsers(c *gin.Context) {
	var req importRequest
	if !readRequest(c, &req, 256<<10) {
		return
	}
	s.importUsers(c, req)
}

func (s *Service) importUsers(c *gin.Context, req importRequest) {
	if !utf8.ValidString(req.CSV) {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(req.CSV, "\ufeff")))
	header, err := r.Read()
	if err != nil || (strings.Join(header, ",") != "账号,姓名,学号,初始密码,用户组" && strings.Join(header, ",") != "账号,姓名,学号,初始密码,用户组,手机号") {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	rows := []importRow{}
	seen := map[string]bool{}
	seenPhones := map[string]bool{}
	for {
		values, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(rows) >= 100 {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
		line, _ := r.FieldPos(0)
		row := importRow{Line: line, Username: strings.TrimSpace(values[0]), Name: strings.TrimSpace(values[1]), ID: strings.TrimSpace(values[2]), password: values[3]}
		phoneOK := true
		if len(values) == 6 {
			row.Phone, phoneOK = model.NormalizePhone(values[5])
		}
		groups := strings.FieldsFunc(values[4], func(r rune) bool { return r == '|' || r == '、' || r == ',' })
		if strings.TrimSpace(values[4]) == "" {
			groups = []string{"formal_user"}
		}
		var ok bool
		row.Groups, ok = normalizeGroups(groups)
		switch {
		case row.Username == "" || utf8.RuneCountInString(row.Username) > 120 || strings.ContainsAny(row.Username, "/\\") || strings.IndexFunc(row.Username, unicode.IsSpace) >= 0 || strings.IndexFunc(row.Username, unicode.IsControl) >= 0:
			row.Error = "账号必填，最多120字，不能含空白、控制字符或斜杠"
		case row.Name == "" || utf8.RuneCountInString(row.Name) > 80 || row.ID == "" || utf8.RuneCountInString(row.ID) > 120:
			row.Error = "姓名及学号必填，分别最多80字、120字"
		case len(row.password) < 12 || len(row.password) > 72:
			row.Error = "初始密码须为12至72字节"
		case !ok:
			row.Error = "用户组无效，请使用固定用户组代码，以 | 分隔"
		case seen[row.Username]:
			row.Error = "文件内账号重复"
		case !phoneOK:
			row.Error = "手机号须为11位有效手机号码"
		case row.Phone != "" && seenPhones[row.Phone]:
			row.Error = "文件内手机号重复"
		}
		seen[row.Username] = true
		if row.Phone != "" {
			seenPhones[row.Phone] = true
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	valid, imported := true, 0
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Usernames are intentionally non-unique for SSO identities. Serialize
		// local imports on PostgreSQL; SQLite already serializes writers.
		if tx.Dialector.Name() == "postgres" && req.Commit {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(71002941)").Error; err != nil {
				return err
			}
		}
		usernames := make([]string, 0, len(rows))
		for _, row := range rows {
			usernames = append(usernames, row.Username)
		}
		var existing []string
		if err := tx.Model(&model.User{}).Where("username IN ?", usernames).Pluck("username", &existing).Error; err != nil {
			return err
		}
		taken := map[string]bool{}
		for _, name := range existing {
			taken[name] = true
		}
		for i := range rows {
			if rows[i].Phone != "" {
				var count int64
				if err := tx.Model(&model.User{}).Where("phone=?", rows[i].Phone).Count(&count).Error; err != nil {
					return err
				}
				if count != 0 {
					rows[i].Error = "手机号已绑定其他账号"
				}
			}
			if taken[rows[i].Username] {
				rows[i].Error = "账号已存在，不会覆盖"
			}
			if rows[i].Error != "" {
				valid = false
			}
		}
		if !valid || !req.Commit {
			return nil
		}
		for _, row := range rows {
			hash, err := bcrypt.GenerateFromPassword([]byte(row.password), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			var id [16]byte
			if _, err := rand.Read(id[:]); err != nil {
				return err
			}
			u := model.User{Sub: "local:" + hex.EncodeToString(id[:]), Username: row.Username, Name: row.Name, ID: row.ID, Phone: row.Phone, Groups: strings.Join(row.Groups, ","), Status: "active", PasswordHash: string(hash), PasswordSetupRequired: true}
			if err := tx.Create(&u).Error; err != nil {
				return err
			}
		}
		imported = len(rows)
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			errhandler.Fail(c, errhandler.VersionConflict)
		} else {
			errhandler.Fail(c, errhandler.InternalError)
		}
		return
	}
	errhandler.OK(c, gin.H{"rows": rows, "valid": valid, "imported": imported})
}
