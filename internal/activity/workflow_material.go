package activity

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/beevik/etree"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/model"
)

//go:embed templates/attachment1.docx
var attachmentTemplate []byte

const templateChecksum = "D597252EA938C07F156D9F882EDBAFF04CDD942CC71350DB456D62BDAD5955BB"

var materialRules = []string{"定位打卡", "扫动态码", "定位扫码"}
var materialRecruitments = []string{"免审密码招募", "公开招募", "定向招募"}
var materialGuarantees = []string{"志愿者保险", "集中乘车", "交通补贴", "餐饮或食物", "提供饮水", "提供住宿", "志愿者服装", "志愿服务工具", "免费体检", "专项培训", "志愿服务证书", "其他"}

func (s *Service) applyMaterialDefaults(m *Material) {
	d := s.MaterialDefaults
	if m.Team == "" {
		m.Team = d.Team
	}
	if m.Notes == "" {
		m.Notes = d.Notes
	}
	if m.Training == "" {
		m.Training = d.Training
	}
	for _, field := range []struct {
		target *string
		value  string
	}{
		{&m.ContactName, d.ContactName}, {&m.ContactPhone, d.ContactPhone},
		{&m.ContactMobile, d.ContactMobile}, {&m.ContactEmail, d.ContactEmail},
	} {
		if field.value != "" {
			*field.target = field.value
		}
	}
	if m.Guarantees == nil {
		m.Guarantees = []string{}
	}
}

func validMaterialOptions(m Material) bool {
	if m.CheckinRule != "" && !slices.Contains(materialRules, m.CheckinRule) || m.Recruitment != "" && !slices.Contains(materialRecruitments, m.Recruitment) {
		return false
	}
	seen := map[string]bool{}
	for _, option := range m.Guarantees {
		if !slices.Contains(materialGuarantees, option) || seen[option] {
			return false
		}
		seen[option] = true
	}
	return true
}

func setCell(cell *etree.Element, value string) {
	paragraphs := cell.SelectElements("p")
	var p *etree.Element
	if len(paragraphs) > 0 {
		p = paragraphs[0]
		for _, extra := range paragraphs[1:] {
			cell.RemoveChild(extra)
		}
	} else {
		p = cell.CreateElement("w:p")
	}
	var props *etree.Element
	if run := p.SelectElement("r"); run != nil {
		if pr := run.SelectElement("rPr"); pr != nil {
			props = pr.Copy()
		}
	}
	if props == nil {
		if pp := p.SelectElement("pPr"); pp != nil {
			if rp := pp.SelectElement("rPr"); rp != nil {
				props = rp.Copy()
			}
		}
	}
	for _, child := range append([]etree.Token{}, p.Child...) {
		if element, ok := child.(*etree.Element); ok && element.Tag == "pPr" {
			continue
		}
		p.RemoveChild(child)
	}
	run := p.CreateElement("w:r")
	if props != nil {
		run.AddChild(props)
	}
	for i, line := range strings.Split(value, "\n") {
		if i > 0 {
			run.CreateElement("w:br")
		}
		text := run.CreateElement("w:t")
		text.CreateAttr("xml:space", "preserve")
		text.SetText(line)
	}
	if pp := p.SelectElement("pPr"); pp != nil {
		if spacing := pp.SelectElement("spacing"); spacing != nil && spacing.SelectAttrValue("w:lineRule", "") == "exact" {
			spacing.CreateAttr("w:lineRule", "atLeast")
		}
	}
}

func checkbox(cell *etree.Element, selected map[int]bool) error {
	symbols := cell.FindElements(".//w:sym")
	if len(symbols) == 0 {
		return errInvalid
	}
	for i, s := range symbols {
		glyph := "00A8"
		if selected[i] {
			glyph = "00FE"
		}
		s.CreateAttr("w:char", glyph)
	}
	return nil
}

func fillAttachment(state State) ([]byte, error) {
	sum := sha256.Sum256(attachmentTemplate)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), templateChecksum) {
		return nil, fmt.Errorf("material: unexpected template checksum")
	}
	reader, err := zip.NewReader(bytes.NewReader(attachmentTemplate), int64(len(attachmentTemplate)))
	if err != nil {
		return nil, err
	}
	var document []byte
	for _, f := range reader.File {
		if f.Name == "word/document.xml" {
			r, e := f.Open()
			if e != nil {
				return nil, e
			}
			document, e = io.ReadAll(r)
			closeErr := r.Close()
			if e != nil {
				return nil, e
			}
			if closeErr != nil {
				return nil, closeErr
			}
		}
	}
	doc := etree.NewDocument()
	if err := doc.ReadFromBytes(document); err != nil {
		return nil, err
	}
	if doc.Root() == nil {
		return nil, errInvalid
	}
	body := doc.Root().SelectElement("body")
	if body == nil {
		return nil, errInvalid
	}
	tables := body.SelectElements("tbl")
	if len(tables) != 2 {
		return nil, errInvalid
	}
	rows := tables[0].SelectElements("tr")
	if len(rows) != 11 {
		return nil, errInvalid
	}
	put := func(row, col int, text string) error {
		cells := rows[row].SelectElements("tc")
		if len(cells) <= col {
			return errInvalid
		}
		setCell(cells[col], text)
		return nil
	}
	m := state.Material
	b := state.Basics
	dates := []string{}
	seen := map[string]bool{}
	for _, session := range b.Sessions {
		start, err := time.Parse(time.RFC3339, session.Start)
		if err != nil {
			return nil, errInvalid
		}
		date := start.In(projectTimezone).Format("2006-01-02")
		if !seen[date] {
			dates = append(dates, date)
			seen[date] = true
		}
	}
	max := ""
	if m.MaxDailyHours != nil {
		max = strconv.Itoa(*m.MaxDailyHours) + "小时"
	}
	for _, entry := range []struct {
		row, col int
		text     string
	}{{1, 1, b.Name}, {1, 3, m.Team}, {2, 1, m.Audience}, {2, 3, b.Location}, {3, 1, m.RegistrationStart}, {3, 3, m.RegistrationEnd}, {4, 1, strings.Join(dates, "、")}, {6, 1, m.CheckinStart}, {6, 3, m.CheckinEnd}, {7, 1, max}, {8, 1, m.Recruitment}, {8, 3, m.Password}, {10, 1, m.Description}} {
		if err := put(entry.row, entry.col, entry.text); err != nil {
			return nil, err
		}
	}
	rules := map[int]bool{}
	for i, v := range materialRules {
		if v == m.CheckinRule {
			rules[i] = true
		}
	}
	if err := checkbox(rows[5].SelectElements("tc")[1], rules); err != nil {
		return nil, err
	}
	labels := materialGuarantees
	selected := map[int]bool{}
	for i, label := range labels {
		for _, v := range m.Guarantees {
			if v == label {
				selected[i] = true
			}
		}
		if label == "其他" && m.OtherGuarantee != "" {
			selected[i] = true
		}
	}
	guaranteeCell := rows[9].SelectElements("tc")[1]
	if err := checkbox(guaranteeCell, selected); err != nil {
		return nil, err
	}
	if m.OtherGuarantee != "" {
		for _, text := range guaranteeCell.FindElements(".//w:t") {
			if strings.TrimSpace(text.Text()) == "其他" {
				text.SetText("其他：" + m.OtherGuarantee)
			}
		}
	}
	second := tables[1]
	original := second.SelectElements("tr")
	if len(original) < 11 {
		return nil, errInvalid
	}
	template := original[2]
	marker := original[4]
	count := 0
	for _, session := range b.Sessions {
		for _, position := range session.Positions {
			count++
			clone := template.Copy()
			cells := clone.SelectElements("tc")
			if len(cells) != 5 {
				return nil, errInvalid
			}
			for i, value := range []string{strconv.Itoa(count), position.Name, strconv.Itoa(position.Capacity), position.Description, b.Location} {
				setCell(cells[i], value)
			}
			second.InsertChildAt(marker.Index(), clone)
		}
	}
	if count > 0 {
		second.RemoveChild(original[2])
		second.RemoveChild(original[3])
	}
	for _, entry := range []struct {
		row, col int
		text     string
	}{{5, 1, m.ContactName}, {5, 3, m.ContactPhone}, {6, 1, m.ContactMobile}, {6, 3, m.ContactEmail}, {8, 0, m.Notes}, {10, 0, m.Training}} {
		cells := original[entry.row].SelectElements("tc")
		if len(cells) <= entry.col {
			return nil, errInvalid
		}
		setCell(cells[entry.col], entry.text)
	}
	for _, height := range body.FindElements(".//w:trHeight") {
		height.CreateAttr("w:hRule", "atLeast")
	}
	if props := original[1].SelectElement("trPr"); props != nil {
		props.CreateElement("w:tblHeader")
	}
	// Match the reference export: preserve title styling, normalize body fonts.
	for _, p := range body.FindElements(".//w:p") {
		title := false
		for _, t := range p.FindElements(".//w:t") {
			if strings.Contains(t.Text(), "北京航空航天大学志愿服务活动立项申请表") {
				title = true
			}
		}
		if title {
			continue
		}
		for _, r := range p.SelectElements("r") {
			pr := r.SelectElement("rPr")
			if pr == nil {
				pr = r.CreateElement("w:rPr")
			}
			font := pr.SelectElement("rFonts")
			if font == nil {
				font = pr.CreateElement("w:rFonts")
			}
			for _, attr := range []string{"ascii", "hAnsi", "eastAsia", "cs"} {
				font.CreateAttr("w:"+attr, "仿宋_GB2312")
				font.RemoveAttr("w:" + attr + "Theme")
			}
			for _, tag := range []string{"sz", "szCs"} {
				el := pr.SelectElement(tag)
				if el == nil {
					el = pr.CreateElement("w:" + tag)
				}
				el.CreateAttr("w:val", "24")
			}
		}
	}
	document, err = doc.WriteToBytes()
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, file := range reader.File {
		header := file.FileHeader
		out, e := writer.CreateHeader(&header)
		if e != nil {
			return nil, e
		}
		if file.Name == "word/document.xml" {
			_, err = out.Write(document)
		} else {
			input, e := file.Open()
			if e != nil {
				return nil, e
			}
			_, err = io.Copy(out, input)
			closeErr := input.Close()
			if err == nil {
				err = closeErr
			}
		}
		if err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func (s *Service) saveMaterial(c *gin.Context) {
	var req Material
	if !decodeBody(c, &req) {
		return
	}
	if req.Guarantees == nil {
		req.Guarantees = []string{}
	}
	s.applyMaterialDefaults(&req)
	s.mutate(c, "material.save", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if err := dataEditable(p, u); err != nil {
			return "", err
		}
		if !validMaterialOptions(req) || len([]rune(req.Description)) > 500 || req.MaxDailyHours != nil && (*req.MaxDailyHours < 0 || *req.MaxDailyHours > 24) {
			return "", errInvalid
		}
		state.Material = req
		return "", nil
	})
}

func (s *Service) generateMaterial(c *gin.Context) {
	var req struct{}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "material.generate", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if err := dataEditable(p, u); err != nil {
			return "", err
		}
		s.applyMaterialDefaults(&state.Material)
		m := state.Material
		if !basicsValid(state.Basics) {
			return "", errInvalid
		}
		if strings.TrimSpace(m.Team) == "" || strings.TrimSpace(m.Audience) == "" || strings.TrimSpace(m.Description) == "" || strings.TrimSpace(m.ContactName) == "" || m.ContactMobile == "" && m.ContactPhone == "" {
			return "", errInvalid
		}
		data, err := fillAttachment(*state)
		if err != nil {
			return "", err
		}
		sum := sha256.Sum256(data)
		safe := strings.Map(func(r rune) rune {
			if strings.ContainsRune("/\\:*?\"<>|\r\n", r) {
				return '_'
			}
			return r
		}, p.Name)
		file := model.MaterialVersion{ID: newID(), ProjectID: p.ID, Version: row.Version + 1, Filename: "16-" + safe + "-附件1.docx", Checksum: hex.EncodeToString(sum[:]), TemplateChecksum: templateChecksum, Data: data, CreatedAt: time.Now().UTC()}
		return "", tx.Create(&file).Error
	})
}

func (s *Service) downloadMaterial(c *gin.Context) {
	p, err := s.getProject(c, false)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	var file model.MaterialVersion
	if err := s.DB.WithContext(c.Request.Context()).Where("id=? AND project_id=?", c.Param("fileID"), p.ID).First(&file).Error; err != nil {
		failWorkflow(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(file.Filename))
	c.Data(200, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", file.Data)
}
