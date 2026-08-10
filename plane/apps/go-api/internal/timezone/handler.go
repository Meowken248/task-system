package timezone

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"
	_ "time/tzdata"
)

type location struct {
	label string
	value string
}

type item struct {
	UTCOffset string `json:"utc_offset"`
	GMTOffset string `json:"gmt_offset"`
	Value     string `json:"value"`
	Label     string `json:"label"`
	offset    int
}

// Handler mirrors Django's public TimezoneEndpoint. Offsets are calculated at
// request time so daylight-saving changes remain identical to pytz behavior.
type Handler struct{}

func (Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	now := time.Now()
	result := make([]item, 0, len(locations))
	for _, candidate := range locations {
		zone, err := time.LoadLocation(candidate.value)
		if err != nil {
			continue
		}
		_, seconds := now.In(zone).Zone()
		offset := formatOffset(seconds)
		result = append(result, item{
			UTCOffset: "UTC" + offset,
			GMTOffset: "GMT" + offset,
			Value:     candidate.value,
			Label:     candidate.label,
			offset:    offsetSortValue(seconds),
		})
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].offset == result[j].offset {
			return result[i].Label < result[j].Label
		}
		return result[i].offset < result[j].offset
	})
	w.Header().Set("Cache-Control", "public, max-age=7200")
	writeJSON(w, http.StatusOK, map[string]any{"timezones": result})
}

func formatOffset(seconds int) string {
	// Keep the legacy endpoint's Python floor-division behavior verbatim,
	// including its display for negative half-hour offsets.
	hours := seconds / 3600
	if seconds < 0 && seconds%3600 != 0 {
		hours--
	}
	remainder := seconds - hours*3600
	if remainder < 0 {
		remainder = -remainder
	}
	sign := '+'
	if hours < 0 {
		sign = '-'
		hours = -hours
	}
	return string(sign) + twoDigits(hours) + ":" + twoDigits(remainder/60)
}

func offsetSortValue(seconds int) int {
	// Python int(strftime("%z")) sorts offsets as signed HHMM integers.
	sign := 1
	if seconds < 0 {
		sign = -1
		seconds = -seconds
	}
	return sign * ((seconds/3600)*100 + (seconds%3600)/60)
}

func twoDigits(value int) string {
	return string([]byte{'0' + byte(value/10), '0' + byte(value%10)})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

var locations = []location{
	{"Midway Island", "Pacific/Midway"}, {"American Samoa", "Pacific/Pago_Pago"},
	{"Hawaii", "Pacific/Honolulu"}, {"Aleutian Islands", "America/Adak"},
	{"Marquesas Islands", "Pacific/Marquesas"}, {"Alaska", "America/Anchorage"},
	{"Gambier Islands", "Pacific/Gambier"}, {"Pacific Time (US and Canada)", "America/Los_Angeles"},
	{"Baja California", "America/Tijuana"}, {"Mountain Time (US and Canada)", "America/Denver"},
	{"Arizona", "America/Phoenix"}, {"Chihuahua, Mazatlan", "America/Chihuahua"},
	{"Central Time (US and Canada)", "America/Chicago"}, {"Saskatchewan", "America/Regina"},
	{"Guadalajara, Mexico City, Monterrey", "America/Mexico_City"}, {"Tegucigalpa, Honduras", "America/Tegucigalpa"},
	{"Costa Rica", "America/Costa_Rica"}, {"Eastern Time (US and Canada)", "America/New_York"},
	{"Lima", "America/Lima"}, {"Bogota", "America/Bogota"}, {"Quito", "America/Guayaquil"},
	{"Chetumal", "America/Cancun"}, {"Caracas (Old Venezuela Time)", "America/Caracas"},
	{"Atlantic Time (Canada)", "America/Halifax"}, {"Caracas", "America/Caracas"},
	{"Santiago", "America/Santiago"}, {"La Paz", "America/La_Paz"}, {"Manaus", "America/Manaus"},
	{"Georgetown", "America/Guyana"}, {"Bermuda", "Atlantic/Bermuda"},
	{"Newfoundland Time (Canada)", "America/St_Johns"}, {"Buenos Aires", "America/Argentina/Buenos_Aires"},
	{"Brasilia", "America/Sao_Paulo"}, {"Greenland", "America/Godthab"},
	{"Montevideo", "America/Montevideo"}, {"Falkland Islands", "Atlantic/Stanley"},
	{"South Georgia and the South Sandwich Islands", "Atlantic/South_Georgia"},
	{"Azores", "Atlantic/Azores"}, {"Cape Verde Islands", "Atlantic/Cape_Verde"},
	{"Dublin", "Europe/Dublin"}, {"Reykjavik", "Atlantic/Reykjavik"}, {"Lisbon", "Europe/Lisbon"},
	{"Monrovia", "Africa/Monrovia"}, {"Casablanca", "Africa/Casablanca"},
	{"Central European Time (Berlin, Rome, Paris)", "Europe/Paris"}, {"West Central Africa", "Africa/Lagos"},
	{"Algiers", "Africa/Algiers"}, {"Lagos", "Africa/Lagos"}, {"Tunis", "Africa/Tunis"},
	{"Eastern European Time (Cairo, Helsinki, Kyiv)", "Europe/Kyiv"}, {"Athens", "Europe/Athens"},
	{"Jerusalem", "Asia/Jerusalem"}, {"Johannesburg", "Africa/Johannesburg"}, {"Harare, Pretoria", "Africa/Harare"},
	{"Moscow Time", "Europe/Moscow"}, {"Baghdad", "Asia/Baghdad"}, {"Nairobi", "Africa/Nairobi"},
	{"Kuwait, Riyadh", "Asia/Riyadh"}, {"Tehran", "Asia/Tehran"}, {"Abu Dhabi", "Asia/Dubai"},
	{"Baku", "Asia/Baku"}, {"Yerevan", "Asia/Yerevan"}, {"Astrakhan", "Europe/Astrakhan"},
	{"Tbilisi", "Asia/Tbilisi"}, {"Mauritius", "Indian/Mauritius"}, {"Kabul", "Asia/Kabul"},
	{"Islamabad", "Asia/Karachi"}, {"Karachi", "Asia/Karachi"}, {"Tashkent", "Asia/Tashkent"},
	{"Yekaterinburg", "Asia/Yekaterinburg"}, {"Maldives", "Indian/Maldives"}, {"Chagos", "Indian/Chagos"},
	{"Chennai", "Asia/Kolkata"}, {"Kolkata", "Asia/Kolkata"}, {"Mumbai", "Asia/Kolkata"},
	{"New Delhi", "Asia/Kolkata"}, {"Sri Jayawardenepura", "Asia/Colombo"}, {"Kathmandu", "Asia/Kathmandu"},
	{"Dhaka", "Asia/Dhaka"}, {"Almaty", "Asia/Almaty"}, {"Bishkek", "Asia/Bishkek"},
	{"Thimphu", "Asia/Thimphu"}, {"Yangon (Rangoon)", "Asia/Yangon"}, {"Cocos Islands", "Indian/Cocos"},
	{"Bangkok", "Asia/Bangkok"}, {"Hanoi", "Asia/Ho_Chi_Minh"}, {"Jakarta", "Asia/Jakarta"},
	{"Novosibirsk", "Asia/Novosibirsk"}, {"Krasnoyarsk", "Asia/Krasnoyarsk"},
	{"Beijing", "Asia/Shanghai"}, {"Singapore", "Asia/Singapore"}, {"Perth", "Australia/Perth"},
	{"Hong Kong", "Asia/Hong_Kong"}, {"Ulaanbaatar", "Asia/Ulaanbaatar"}, {"Palau", "Pacific/Palau"},
	{"Eucla", "Australia/Eucla"}, {"Tokyo", "Asia/Tokyo"}, {"Seoul", "Asia/Seoul"}, {"Yakutsk", "Asia/Yakutsk"},
	{"Adelaide", "Australia/Adelaide"}, {"Darwin", "Australia/Darwin"}, {"Sydney", "Australia/Sydney"},
	{"Brisbane", "Australia/Brisbane"}, {"Guam", "Pacific/Guam"}, {"Vladivostok", "Asia/Vladivostok"},
	{"Tahiti", "Pacific/Tahiti"}, {"Lord Howe Island", "Australia/Lord_Howe"},
	{"Solomon Islands", "Pacific/Guadalcanal"}, {"Magadan", "Asia/Magadan"},
	{"Norfolk Island", "Pacific/Norfolk"}, {"Bougainville Island", "Pacific/Bougainville"},
	{"Chokurdakh", "Asia/Srednekolymsk"}, {"Auckland", "Pacific/Auckland"},
	{"Wellington", "Pacific/Auckland"}, {"Fiji Islands", "Pacific/Fiji"}, {"Anadyr", "Asia/Anadyr"},
	{"Chatham Islands", "Pacific/Chatham"}, {"Nuku'alofa", "Pacific/Tongatapu"},
	{"Samoa", "Pacific/Apia"}, {"Kiritimati Island", "Pacific/Kiritimati"},
}
