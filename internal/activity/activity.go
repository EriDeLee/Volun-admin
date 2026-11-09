// Package activity implements the activity administrator's project homepage.
package activity

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

type Service struct{ DB *gorm.DB }

var statuses = []string{"立项", "筹备", "招募", "进行", "结项", "意向", "统计", "数据", "录入", "审核", "通过", "驳回"}
var pendingStatuses = []string{"立项", "筹备", "招募", "结项", "意向"}
var instructions = map[string]string{
	"立项": "核对基础信息，准备立项申请材料。",
	"筹备": "确认服务安排与岗位，准备志愿者登记。",
	"招募": "核对招募名单与岗位、场次安排。",
	"结项": "核对实际参与情况，补齐服务记录。",
	"意向": "跟进时长录入意向收集，确认截止安排。",
}

func hasGroup(u model.User, group string) bool {
	for _, g := range strings.Split(u.Groups, ",") {
		if g == group {
			return true
		}
	}
	return false
}

// RequireManager runs after authentication and initial-password enforcement.
func RequireManager(c *gin.Context) {
	u, ok := c.MustGet("user").(model.User)
	if !ok || (!hasGroup(u, "super_admin") && !hasGroup(u, "activity_admin") && !hasGroup(u, "data_admin")) {
		errhandler.Fail(c, errhandler.PermissionDenied)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Next()
}

func (s *Service) scope(c *gin.Context) *gorm.DB {
	u := c.MustGet("user").(model.User)
	q := s.DB.WithContext(c.Request.Context()).Model(&model.Project{})
	if !hasGroup(u, "super_admin") {
		if hasGroup(u, "data_admin") {
			if hasGroup(u, "activity_admin") {
				q = q.Where("approval <> ? OR created_by = ?", "draft", u.Sub)
			} else {
				q = q.Where("approval <> ?", "draft")
			}
		} else {
			q = q.Where("created_by = ?", u.Sub)
		}
	}
	return q
}

func projectJSON(p model.Project) dto.ProjectResponse {
	return dto.ProjectResponse{ID: p.ID, Code: p.Code, Name: p.Name, Department: p.Department, StartsOn: p.StartsOn, EndsOn: p.EndsOn, Location: p.Location, Description: p.Description, Status: p.Status, Approval: p.Approval, OwnerName: p.OwnerName, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}
}

func (s *Service) Dashboard(c *gin.Context) {
	u := c.MustGet("user").(model.User)
	data := dto.ActivityDashboard{Scope: "owned", GeneratedAt: time.Now().UTC(), Tasks: []dto.ActivityTask{}, RecentProjects: []dto.ProjectResponse{}, Stages: []dto.ActivityStage{}}
	if dataManager(u) {
		data.Scope = "all"
	}
	// A read transaction keeps this small aggregate internally consistent in SQLite.
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		service := &Service{DB: tx}
		var counts []dto.ActivityStage
		if err := service.scope(c).Select("status, COUNT(*) AS count").Group("status").Scan(&counts).Error; err != nil {
			return err
		}
		byStatus := map[string]int64{}
		for _, stage := range counts {
			byStatus[stage.Status] = stage.Count
			data.Summary.ProjectCount += stage.Count
		}
		data.Summary.RecruitingCount = byStatus["招募"]
		for _, status := range pendingStatuses {
			data.Summary.PendingCount += byStatus[status]
		}
		for _, status := range statuses {
			data.Stages = append(data.Stages, dto.ActivityStage{Status: status, Count: byStatus[status]})
		}
		var recent []model.Project
		if err := service.scope(c).Order("updated_at DESC, id DESC").Limit(12).Find(&recent).Error; err != nil {
			return err
		}
		for _, p := range recent {
			data.RecentProjects = append(data.RecentProjects, projectJSON(p))
		}
		var pending []model.Project
		if err := service.scope(c).Where("status IN ?", pendingStatuses).Order("updated_at DESC, id DESC").Limit(5).Find(&pending).Error; err != nil {
			return err
		}
		for _, p := range pending {
			data.Tasks = append(data.Tasks, dto.ActivityTask{ProjectID: p.ID, ProjectName: p.Name, Status: p.Status, Instruction: instructions[p.Status]})
		}
		return nil
	})
	if err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	errhandler.OK(c, data)
}

func (s *Service) CreateProject(c *gin.Context) {
	if u := actor(c); !hasGroup(u, "super_admin") && !hasGroup(u, "activity_admin") {
		errhandler.Fail(c, errhandler.PermissionDenied)
		return
	}
	if c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
		errhandler.Fail(c, errhandler.CSRFValidationFailed)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var req dto.CreateProjectRequest
	decoder := json.NewDecoder(c.Request.Body)
	if decoder.Decode(&req) != nil {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	// Consume the full body so trailing JSON or padding cannot bypass the limit.
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	req.Name, req.Department, req.Location = strings.TrimSpace(req.Name), strings.TrimSpace(req.Department), strings.TrimSpace(req.Location)
	req.Description = strings.TrimSpace(req.Description)
	start, e1 := time.Parse(time.DateOnly, req.StartsOn)
	end, e2 := time.Parse(time.DateOnly, req.EndsOn)
	if req.Name == "" || utf8.RuneCountInString(req.Name) > 80 || req.Department == "" || utf8.RuneCountInString(req.Department) > 80 || req.Location == "" || utf8.RuneCountInString(req.Location) > 160 || utf8.RuneCountInString(req.Description) > 2000 || e1 != nil || e2 != nil || end.Before(start) {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	u := c.MustGet("user").(model.User)
	id := hex.EncodeToString(random[:])
	ownerName := u.Name
	if ownerName == "" {
		ownerName = u.Username
	}
	p := model.Project{ID: id, Code: "ZY-" + time.Now().UTC().Format("20060102") + "-" + strings.ToUpper(id[:12]), Name: req.Name, Department: req.Department, StartsOn: req.StartsOn, EndsOn: req.EndsOn, Location: req.Location, Description: req.Description, Status: "立项", Approval: "draft", CreatedBy: u.Sub, OwnerName: ownerName}
	if err := s.DB.WithContext(c.Request.Context()).Create(&p).Error; err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	errhandler.OK(c, projectJSON(p))
}

func (s *Service) GetProject(c *gin.Context) {
	var p model.Project
	if err := s.scope(c).Where("id = ?", c.Param("id")).First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			errhandler.Fail(c, errhandler.ResourceNotFound)
		} else {
			errhandler.Fail(c, errhandler.InternalError)
		}
		return
	}
	errhandler.OK(c, projectJSON(p))
}

// ListProjects returns a paginated ledger within the authenticated manager's scope.
func (s *Service) ListProjects(c *gin.Context) {
	u := c.MustGet("user").(model.User)
	qText := strings.TrimSpace(c.Query("q"))
	status := strings.TrimSpace(c.Query("status"))
	department := strings.TrimSpace(c.Query("department"))
	view := strings.TrimSpace(c.Query("view"))
	page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, sizeErr := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageErr != nil || sizeErr != nil || page < 1 || page > 1_000_000 || pageSize < 1 || pageSize > 100 || utf8.RuneCountInString(qText) > 160 || utf8.RuneCountInString(department) > 80 {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	if status != "" {
		valid := false
		for _, known := range statuses {
			if known == status {
				valid = true
				break
			}
		}
		if !valid {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
	}
	if view != "" && view != "all" && view != "pending" {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}

	data := dto.ProjectListResponse{
		Items: []dto.ProjectResponse{}, Page: page, PageSize: pageSize,
		Departments: []string{}, Scope: "owned",
	}
	if dataManager(u) {
		data.Scope = "all"
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		service := &Service{DB: tx}
		// Filter choices and summary describe the entire authorized scope.
		if err := service.scope(c).Distinct("department").Order("department ASC").Pluck("department", &data.Departments).Error; err != nil {
			return err
		}
		var counts []dto.ActivityStage
		if err := service.scope(c).Select("status, COUNT(*) AS count").Group("status").Scan(&counts).Error; err != nil {
			return err
		}
		for _, stage := range counts {
			data.Summary.ProjectCount += stage.Count
			if stage.Status == "招募" {
				data.Summary.RecruitingCount = stage.Count
			}
			for _, pending := range pendingStatuses {
				if stage.Status == pending {
					data.Summary.PendingCount += stage.Count
					break
				}
			}
		}

		filtered := service.scope(c)
		if qText != "" {
			// Search literal text: wildcard characters cannot expand a user's query.
			text := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(qText)
			like := "%" + text + "%"
			filtered = filtered.Where("(name LIKE ? ESCAPE '!' OR code LIKE ? ESCAPE '!')", like, like)
		}
		if status != "" {
			filtered = filtered.Where("status = ?", status)
		}
		if department != "" {
			filtered = filtered.Where("department = ?", department)
		}
		if view == "pending" {
			filtered = filtered.Where("status IN ?", pendingStatuses)
		}
		if err := filtered.Session(&gorm.Session{}).Count(&data.Total).Error; err != nil {
			return err
		}
		var rows []model.Project
		if err := filtered.Session(&gorm.Session{}).Order("updated_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
			return err
		}
		for _, p := range rows {
			data.Items = append(data.Items, projectJSON(p))
		}
		return nil
	})
	if err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	errhandler.OK(c, data)
}
