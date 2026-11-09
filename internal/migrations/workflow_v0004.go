package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/model"
)

func workflowV4(db *gorm.DB) error {
	if err := db.AutoMigrate(&model.Workflow{}, &model.WorkflowEvent{}, &model.MaterialVersion{}, &model.ParticipantGrant{}, &model.Project{}); err != nil {
		return err
	}
	return db.Model(&model.Project{}).Where("approval = ? OR approval IS NULL", "").Update("approval", gorm.Expr("CASE WHEN status = '立项' THEN 'draft' ELSE 'approved' END")).Error
}
