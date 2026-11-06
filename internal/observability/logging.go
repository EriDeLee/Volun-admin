package observability

import (
	"fmt"
	"log/slog"
	"os"
)

func NewLogger(levelName string) (*slog.Logger, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(levelName)); err != nil {
		return nil, fmt.Errorf("invalid log level: %w", err)
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})), nil
}
