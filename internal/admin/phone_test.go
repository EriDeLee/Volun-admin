//go:build integration

package admin_test

import (
	"encoding/json"
	"strings"
	"testing"

	"volun-data/internal/dto"
	"volun-data/internal/model"
)

func TestUniquePhoneAcrossAccountOperations(t *testing.T) {
	f := setup(t)
	super := f.identity(t, "root", "root", "super_admin", false)
	first := f.identity(t, "a", "a", "formal_user", false)
	second := f.identity(t, "b", "b", "formal_user", false)
	phoneA := "130" + strings.Repeat("0", 7) + "1"
	phoneB := "130" + strings.Repeat("0", 7) + "2"
	phoneC := "130" + strings.Repeat("0", 7) + "3"
	body := func(phone string) string {
		raw, _ := json.Marshal(map[string]string{"phone": phone})
		return string(raw)
	}
	bound := decode[dto.AuthResponse](t, f.request("PUT", "/api/v1/auth/phone", body("+86 "+phoneA), first, true))
	if bound.User.Phone != phoneA {
		t.Fatal("phone normalization failed")
	}
	w := f.request("PUT", "/api/v1/auth/phone", body(phoneA), second, true)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "200011") {
		t.Fatalf("duplicate phone: %d %s", w.Code, w.Body.String())
	}
	if w := f.request("PUT", "/api/v1/auth/phone", body("invalid"), second, true); w.Code != 400 {
		t.Fatalf("invalid phone accepted: %d", w.Code)
	}
	if w := f.request("PUT", "/api/v1/auth/phone", body(phoneB), second, false); w.Code != 403 {
		t.Fatalf("missing header: %d", w.Code)
	}
	decode[dto.AdminUserResponse](t, f.request("PATCH", "/api/v1/admin/users/b", body(phoneB), super, true))
	if w := f.request("PATCH", "/api/v1/admin/users/b", body(phoneA), super, true); w.Code != 409 {
		t.Fatalf("admin duplicate: %d %s", w.Code, w.Body.String())
	}
	me := decode[dto.AuthResponse](t, f.request("GET", "/api/v1/auth/me", "", second, false))
	if me.User.Phone != phoneB {
		t.Fatal("failed update changed phone")
	}
	users := decode[dto.AdminUserListResponse](t, f.request("GET", "/api/v1/admin/users?q="+phoneB, "", super, false))
	if users.Total != 1 || users.Items[0].Phone != phoneB {
		t.Fatal("phone not searchable in directory")
	}
	if err := f.db.Model(&model.User{}).Where("sub=?", "b").Update("phone", phoneA).Error; err == nil {
		t.Fatal("database allowed duplicate phone")
	}
	payload, _ := json.Marshal(map[string]any{"username": "created", "name": "Test", "id": "0003", "phone": phoneC, "password": "synthetic-password"})
	created := decode[struct {
		Valid    bool
		Imported int
	}](t, f.request("POST", "/api/v1/admin/users", string(payload), super, true))
	if !created.Valid || created.Imported != 1 {
		t.Fatal("phone account creation failed")
	}
	csv := "账号,姓名,学号,初始密码,用户组,手机号\nnew1,测试,0004,synthetic-password,formal_user," + phoneC + "\nnew2,测试,0005,synthetic-password,formal_user," + phoneB + "\n"
	payload, _ = json.Marshal(map[string]any{"csv": csv, "commit": true})
	result := decode[struct {
		Valid    bool
		Imported int
	}](t, f.request("POST", "/api/v1/admin/users/import", string(payload), super, true))
	if result.Valid || result.Imported != 0 {
		t.Fatal("duplicate phone import partially committed")
	}
	var count int64
	if err := f.db.Model(&model.User{}).Where("username IN ?", []string{"new1", "new2"}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed import persisted accounts")
	}
	decode[dto.AdminUserResponse](t, f.request("PATCH", "/api/v1/admin/users/a", body(""), super, true))
	decode[dto.AuthResponse](t, f.request("PUT", "/api/v1/auth/phone", body(phoneA), second, true))
}
