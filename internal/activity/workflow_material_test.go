package activity

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/beevik/etree"
)

func TestMaterialDefaultsAndDocumentOptions(t *testing.T) {
	s := Service{MaterialDefaults: Material{Team: "默认团队", ContactName: "默认联系人", ContactPhone: "010-00000000", ContactMobile: "13800000001", ContactEmail: "test@example.test", Notes: "默认说明", Training: "默认培训"}}
	m := Material{ContactName: "旧联系人", Notes: "自填说明", Recruitment: "定向招募", CheckinRule: "定位扫码", Guarantees: []string{"志愿者保险", "提供饮水", "专项培训"}, OtherGuarantee: "其他测试保障"}
	s.applyMaterialDefaults(&m)
	if m.Team != "默认团队" || m.ContactName != "默认联系人" || m.Notes != "自填说明" || m.Training != "默认培训" {
		t.Fatalf("defaults: %+v", m)
	}
	if !validMaterialOptions(m) {
		t.Fatal("known options rejected")
	}
	invalid := m
	invalid.CheckinRule = "未知规则"
	if validMaterialOptions(invalid) {
		t.Fatal("unknown rule accepted")
	}
	invalid = m
	invalid.Recruitment = "未知方式"
	if validMaterialOptions(invalid) {
		t.Fatal("unknown recruitment accepted")
	}
	invalid = m
	invalid.Guarantees = []string{"提供饮水", "提供饮水"}
	if validMaterialOptions(invalid) {
		t.Fatal("duplicate guarantee accepted")
	}
	state := State{Material: m, Basics: Basics{Name: "附件1选项测试", Location: "测试地点", Sessions: []Session{{Name: "上午", Start: "2026-11-13T08:00:00+08:00", End: "2026-11-13T12:00:00+08:00", Positions: []Position{{Name: "引导", Capacity: 10}}}}}}
	content, err := fillAttachment(state)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range archive.File {
		if file.Name != "word/document.xml" {
			continue
		}
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		xml, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
		for _, text := range []string{"定向招募", "默认联系人", "test@example.test", "自填说明", "默认培训", "其他测试保障"} {
			if !strings.Contains(string(xml), text) {
				t.Fatalf("document missing %s", text)
			}
		}
		doc := etree.NewDocument()
		if err := doc.ReadFromBytes(xml); err != nil {
			t.Fatal(err)
		}
		rows := doc.Root().SelectElement("body").SelectElements("tbl")[0].SelectElements("tr")
		rules := rows[5].SelectElements("tc")[1].FindElements(".//w:sym")
		if len(rules) != 3 || rules[2].SelectAttrValue("w:char", "") != "00FE" || rules[0].SelectAttrValue("w:char", "") == "00FE" {
			t.Fatal("incorrect checkin rule checkbox mapping")
		}
		options := rows[9].SelectElements("tc")[1].FindElements(".//w:sym")
		for i, option := range options {
			want := i == 0 || i == 4 || i == 9 || i == 11
			if (option.SelectAttrValue("w:char", "") == "00FE") != want {
				t.Fatalf("incorrect guarantee checkbox %d", i)
			}
		}
		return
	}
	t.Fatal("generated document missing main XML")
}
