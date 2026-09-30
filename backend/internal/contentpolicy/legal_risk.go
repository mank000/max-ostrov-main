package contentpolicy

import "unicode/utf8"

// Community-policy enforcement, not a claim that a specific criminal offence
// has been legally established. Obfuscated phrases use bounded whole matches.
var encodedPolicyRules = []abuseRule{
	{"politics", compileAbuseWords(`госдума госдумы госдуме госдуму госдумой референдум референдума референдуме геополитика геополитики предвыборнаяагитация голосуйтезапартию выборыпрезидента`), false},
	{"prohibited", compileAbuseWords(`продаюмефедрон продаюгероин продаюкокаин купитьмефедрон купитьгероин купитькокаин продажанаркотиков`), false},
	{"threat", compileAbuseWords(`убейсебя убейтесебя призываюубиватьлюдей`), false},
}

func checkEncodedPolicy(value string) error {
	text := normalizedAbuseText(value)
	for _, rule := range encodedPolicyRules {
		for _, m := range rule.pattern.FindAllStringIndex(text, -1) {
			before, _ := utf8.DecodeLastRuneInString(text[:m[0]])
			after, _ := utf8.DecodeRuneInString(text[m[1]:])
			if (m[0] == 0 || !wordRune(before)) && (m[1] == len(text) || !wordRune(after)) {
				if rule.category != "politics" && reportedOrNegated(text[:m[0]]) {
					continue
				}
				return &Violation{Category: rule.category}
			}
		}
	}
	return nil
}
