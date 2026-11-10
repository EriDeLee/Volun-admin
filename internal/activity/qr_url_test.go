package activity

import (
	"net/url"
	"testing"
)

func TestSignupURLUsesFrontendOrigin(t *testing.T) {
	for _, origin := range []string{"http://127.0.0.1:5173", "https://volunteer.example.test/"} {
		for _, query := range []url.Values{
			{"project": {"project"}, "attendance": {"session"}, "token": {"synthetic-token"}},
			{"project": {"project"}, "form": {"form"}},
		} {
			link, err := signupURL(origin, query)
			if err != nil {
				t.Fatal(err)
			}
			target, err := url.Parse(link)
			if err != nil {
				t.Fatal(err)
			}
			frontend, err := url.Parse(origin)
			if err != nil {
				t.Fatal(err)
			}
			if target.Host != frontend.Host || target.Scheme != frontend.Scheme || target.Path != "/signup" || target.RawQuery != query.Encode() {
				t.Fatalf("incorrect frontend link: %s", link)
			}
		}
	}
	for _, origin := range []string{"", "//example.test", "javascript:alert(1)", "http://user:pass@example.test"} {
		if _, err := signupURL(origin, url.Values{}); err == nil {
			t.Fatalf("accepted invalid frontend %q", origin)
		}
	}
}
