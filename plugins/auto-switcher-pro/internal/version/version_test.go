package version

import (
	"regexp"
	"testing"
)

func TestVersionNotEmpty(t *testing.T) {
	if Version == "" {
		t.Fatal("expected non-empty Version")
	}
	semverPattern := `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`
	if !regexp.MustCompile(semverPattern).MatchString(Version) {
		t.Errorf("expected Version %q to match semver pattern %s", Version, semverPattern)
	}
}
