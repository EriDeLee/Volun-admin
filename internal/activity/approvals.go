package activity

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

// ListApprovals includes changes to approved projects as well as initial proposals.
func (s *Service) ListApprovals(c *gin.Context) {
	if !dataManager(actor(c)) {
		failWorkflow(c, errPermission)
		return
	}
	page, e1 := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, e2 := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))
	if e1 != nil || e2 != nil || page < 1 || page > 1_000_000 || size < 1 || size > 100 || len([]rune(q)) > 160 {
		failWorkflow(c, errInvalid)
		return
	}
	type item struct {
		Project     dto.ProjectResponse `json:"project"`
		Application Application         `json:"application"`
	}
	items := []item{}
	total := 0
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var projects []model.Project
		return tx.Where("approval IN ?", []string{"pending", "approved"}).Order("id").FindInBatches(&projects, 100, func(batch *gorm.DB, _ int) error {
			ids := make([]string, 0, len(projects))
			for _, p := range projects {
				ids = append(ids, p.ID)
			}
			var rows []model.Workflow
			if err := tx.Where("project_id IN ?", ids).Find(&rows).Error; err != nil {
				return err
			}
			states := map[string]State{}
			for _, row := range rows {
				var state State
				if err := json.Unmarshal([]byte(row.State), &state); err != nil {
					return err
				}
				states[row.ProjectID] = state
			}
			for _, p := range projects {
				for _, app := range states[p.ID].Applications {
					if app.Status != "pending" || q != "" && !strings.Contains(strings.ToLower(p.Name+" "+p.Code+" "+app.Basics.Name+" "+app.ApplicantName), q) {
						continue
					}
					if total >= (page-1)*size && len(items) < size {
						items = append(items, item{projectJSON(p), app})
					}
					total++
				}
			}
			return nil
		}).Error
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	errhandler.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}
