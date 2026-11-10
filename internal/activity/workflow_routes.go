package activity

import "github.com/gin-gonic/gin"

// RegisterWorkflow keeps operation-level checks inside the transactional handlers.
func (s *Service) RegisterWorkflow(managed, public *gin.RouterGroup) {
	p := managed.Group("/projects/:id")
	p.GET("/workflow", func(c *gin.Context) { s.workflowState(c, false) })
	p.PUT("/basics", s.updateBasics)
	p.POST("/submit", s.submitProject)
	p.POST("/changes", s.requestChange)
	p.POST("/applications/:applicationID/decision", s.decideApplication)
	p.PUT("/members", s.saveMembers)
	p.GET("/members/candidates", s.memberCandidates)
	p.DELETE("/members/:memberID", s.deleteMember)
	p.POST("/members/access", s.manageGrant)
	p.GET("/members/export", s.exportMembers)
	p.PUT("/forms", s.saveForm)
	p.GET("/forms/qr", s.qrCode)
	p.PUT("/windows", s.manageWindow)
	p.POST("/sessions/:sessionID/attendance", s.staffAttendance)
	p.GET("/sessions/:sessionID/qr/:action", s.qrCode)
	p.PUT("/hours", s.saveHours)
	p.POST("/transition", s.transition)
	p.PUT("/material", s.saveMaterial)
	p.POST("/material/generate", s.generateMaterial)
	p.GET("/material/:fileID", s.downloadMaterial)
	p.GET("/history", s.history)

	q := public.Group("/projects/:id", PublicLimit)
	q.GET("/forms/:formID", s.publicForm)
	q.POST("/forms/:formID/responses", s.submitPublicForm)
	q.POST("/access", s.exchangeGrant)
	q.GET("/me", s.ownMember)
	q.PUT("/me", s.updateOwnMember)
	q.POST("/me/bind", s.bindOwn)
	q.GET("/sessions/:sessionID/scan", s.scanContext)
	q.POST("/sessions/:sessionID/scan", s.scanAttendance)
}
