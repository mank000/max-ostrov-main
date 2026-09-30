package contentpolicy

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

type abuseRule struct {
	category    string
	pattern     *regexp.Regexp
	addressOnly bool
}

// Explicit vocabulary, not arbitrary substring roots: "страхуй", "рублями"
// and "подходящий" must remain legal. RE2 keeps adversarial inputs bounded.
var abuseRules = []abuseRule{
	{"insult", compileInsultFamily(), false},
	{"insult", compileAbuseWords(personalAbuseVocabulary), false},
	{"insult", compileAbuseWords(contextualAbuseVocabulary), true},
	{"insult", compileAbuseWords(`п*дор пид*р п*д*р пид*рас пидорочек пидорочка пидорочки пидорочков пидорочком пидорочками пидорчик пидорчики пидорский пидорская пидорские пидор пидора пидору пидором пидоры пидоров пидорам пидорами пидоре пидар пидары пидаров пидорас пидораса пидорасы пидорасов пидорасом пидарас пидарасы педераст педерасты мудак мудака мудаки мудаков мудаком мудила мудилы долбоеб долбоебы долбоеба долбоебов долбоебом долбаеб долбаебы дебил дебилы дебила дебилов идиот идиоты идиота идиотов еблан ебланы уебок уебки уебка уебков`), false},
}

// Bounded spelling/morphology family, rather than fuzzy matching arbitrary words.
// The existing Unicode/transliteration matcher and context checks still apply.
func compileInsultFamily() *regexp.Regexp {
	const separator = `[\s\p{P}\p{S}]*`
	part := func(words string) string { return compileAbuseWords(words).String() }
	root := part("п") + separator + part("и е") + separator + part("д") + separator + part("о а е") + separator + part("р")
	shortEnding := part("а у ом ы ов ам ами е очек очка очки очком чик чики")
	longEnding := part("ь а у ом ы ов ам ами е ина ины иной")
	long := separator + part("а о я е") + separator + part("с з") + "(?:" + separator + longEnding + ")?"
	return regexp.MustCompile(root + "(?:" + long + "|" + separator + shortEnding + ")?")
}

var abuseLetters = map[rune]string{
	'*': `[*#•·?]`, 'а': `[аa@4]`, 'б': `[бb6]`, 'в': `[вvb]`, 'г': `[гgr]`,
	'д': `[дd]`, 'е': `[еeё]`, 'ж': `(?:ж|zh)`, 'з': `[зz3]`,
	'и': `[иіӏιiu1!|]`, 'й': `[йиіyji]`, 'к': `[кk]`, 'л': `[лl]`,
	'м': `[мm]`, 'н': `[нnh]`, 'о': `[оoο0]`, 'п': `[пnp]`,
	'р': `[рrpρ]`, 'с': `[сcs$]`, 'т': `[тt7]`, 'у': `[уuy]`,
	'ф': `[фf]`, 'х': `[хxhχ]`, 'ц': `(?:ц|ts|c)`, 'ч': `(?:ч|ch)`,
	'ш': `(?:ш|sh)`, 'щ': `(?:щ|sch|shch)`, 'ы': `[ыyi]`,
	'ь': `[ьb'’]`, 'ъ': `[ъ'’]`, 'э': `[эe]`, 'ю': `(?:ю|yu|ju|iu)`, 'я': `(?:я|9|@|ya|ja|ia)`,
}

// Share spelling prefixes in the regex instead of scanning every inflection
// independently. Longer endings precede terminal matches to preserve boundaries.
func compileAbuseWords(words string) *regexp.Regexp {
	type node struct {
		terminal bool
		depth    int
		children map[rune]*node
	}
	root := &node{}
	for _, word := range strings.Fields(words) {
		n := root
		for i, r := range []rune(word) {
			remaining := len([]rune(word)) - i
			if remaining > n.depth {
				n.depth = remaining
			}
			if n.children == nil {
				n.children = map[rune]*node{}
			}
			if n.children[r] == nil {
				n.children[r] = &node{}
			}
			n = n.children[r]
		}
		n.terminal = true
	}
	var build func(*node) string
	build = func(n *node) string {
		keys := make([]rune, 0, len(n.children))
		for r := range n.children {
			keys = append(keys, r)
		}
		sort.Slice(keys, func(i, j int) bool {
			if n.children[keys[i]].depth != n.children[keys[j]].depth {
				return n.children[keys[i]].depth > n.children[keys[j]].depth
			}
			return keys[i] < keys[j]
		})
		alternatives := make([]string, 0, len(keys))
		for _, r := range keys {
			child := n.children[r]
			tail := build(child)
			if tail != "" {
				tail = `[\s\p{P}\p{S}]*` + tail
				if child.terminal {
					tail = "(?:" + tail + ")?"
				}
			}
			alternatives = append(alternatives, "(?:"+letterPattern(r)+")+"+tail)
		}
		if len(alternatives) == 0 {
			return ""
		}
		return "(?:" + strings.Join(alternatives, "|") + ")"
	}
	return regexp.MustCompile(build(root))
}
func letterPattern(letter rune) string {
	if alternatives, ok := abuseDigraphs[letter]; ok {
		base := regexp.QuoteMeta(string(letter))
		if pattern, ok := abuseLetters[letter]; ok {
			base = pattern
		}
		patterns := []string{base}
		for _, variant := range alternatives {
			letters := []string{}
			for _, r := range variant {
				letters = append(letters, regexp.QuoteMeta(string(r)))
			}
			patterns = append(patterns, strings.Join(letters, `[\s\p{P}\p{S}]*`))
		}
		return "(?:" + strings.Join(patterns, "|") + ")"
	}
	if pattern, ok := abuseLetters[letter]; ok {
		return pattern
	}
	return regexp.QuoteMeta(string(letter))
}

var abuseDigraphs = map[rune][]string{
	'е': {"ye", "je", "yo", "jo"}, 'ж': {"zh"}, 'ц': {"ts", "c"}, 'ч': {"ch"}, 'ш': {"sh"}, 'щ': {"sch", "shch"},
	'ю': {"yu", "ju", "iu"}, 'я': {"ya", "ja", "ia"},
}

// Encoded syllable "пи". Only classification text changes; published text is untouched.
var encodedPi = regexp.MustCompile(`(?:3\s*[.,]\s*1\s*4|π)`)

func normalizedAbuseText(value string) string {
	value = strings.ToLower(norm.NFKD.String(value))
	value = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r) {
			return -1
		}
		if unicode.IsSpace(r) {
			return ' '
		}
		if r == 'ё' {
			return 'е'
		}
		return r
	}, value)
	return encodedPi.ReplaceAllString(value, "пи")
}
func wordRune(r rune) bool { return unicode.IsLetter(r) }

// CheckObviousText blocks clear personal abuse, including obfuscated spellings.
// Profanity alone is allowed. Mentions and ambiguous context are left to review.
func CheckObviousText(values ...string) error { return checkObviousText(false, values...) }

// Comments address a discussion audience even without an explicit pronoun.
func CheckCommentText(values ...string) error { return checkObviousText(true, values...) }

func checkObviousText(comment bool, values ...string) error {
	for _, value := range values {
		text := normalizedAbuseText(value)
		for _, match := range sexualizedAddress.FindAllStringIndex(text, -1) {
			before, _ := utf8.DecodeLastRuneInString(text[:match[0]])
			after, _ := utf8.DecodeRuneInString(text[match[1]:])
			if (match[0] == 0 || !wordRune(before)) && (match[1] == len(text) || !wordRune(after)) && !reportedOrNegated(text[:match[0]]) {
				return &Violation{Category: "insult"}
			}
		}
		if explicitDirectedThreat(text) {
			return &Violation{Category: "threat"}
		}
		for _, match := range abuseDismissal.FindAllStringIndex(text, -1) {
			before, _ := utf8.DecodeLastRuneInString(text[:match[0]])
			after, _ := utf8.DecodeRuneInString(text[match[1]:])
			if (match[0] == 0 || !wordRune(before)) && (match[1] == len(text) || !wordRune(after)) && strings.Trim(text, " \t\n!.?,") == text[match[0]:match[1]] {
				return &Violation{Category: "insult"}
			}
		}
		for _, rule := range abuseRules {
			for _, match := range rule.pattern.FindAllStringIndex(text, -1) {
				before, _ := utf8.DecodeLastRuneInString(text[:match[0]])
				after, _ := utf8.DecodeRuneInString(text[match[1]:])
				if (match[0] == 0 || !wordRune(before)) && (match[1] == len(text) || !wordRune(after)) {
					if directlyAddressedWithMode(text, match[0], match[1], rule.addressOnly) || (comment && !rule.addressOnly && !reportedOrNegated(text[:match[0]])) {
						return &Violation{Category: rule.category}
					}
				}
			}
		}
		for _, span := range compoundProfanitySpans(text) {
			// Praise such as "ты пиздатый" needs semantic context; it is still
			// labelled as profanity for age and strict-reader filtering.
			word := text[span[0]:span[1]]
			if strings.HasPrefix(word, "пиздат") || strings.HasPrefix(word, "пиздато") {
				continue
			}
			if directlyAddressedWithMode(text, span[0], span[1], true) {
				return &Violation{Category: "insult"}
			}
		}
	}
	return nil
}

// Local context is deliberately conservative: the semantic model handles review.
var directedPrefix = regexp.MustCompile(`(?:^|[^\p{L}])(?:ты|вы|он|она|они|все вы|эти люди|этот человек|эта девушка|этот парень|эта женщина|этот мужчина|этот тип|эта дама|этот пользователь|этот автор|эти пользователи|эти люди|@[a-zа-я0-9_]{2,64})(?:[\s,—–\-«"()]+(?:просто|полныи|полная|полные|такои|такая|такие|настоящии|настоящая|настоящие|опять|все|же|и|ну|конченыи|конченая|конченые|тупои|тупая|тупые|ебаныи|ебаная|ебаные|сраныи|сраная|сраные|жалкии|жалкая|жалкие|мерзкии|мерзкая|мерзкие))*[\s,—–\-«"()]*$`)
var bareInsultPrefix = regexp.MustCompile(`^(?:ну|ну и|вот|вот же|ну ты и|эи|привет)[\s,]*$`)
var negatedPrefix = regexp.MustCompile(`(?:^|[^\p{L}])(?:не|не называи|не называите|не называите людеи|не говори|не говорите|не говорите людям)\s*[:«"]?\s*$`)
var sexualizedAddress = compileAbuseWords(`ятвойротебал явашротебал ятебявротебал явасвротебал ебалятвойрот ебалявашрот яебалтвойрот яебалвашрот яебалротавтора`)

var abuseDismissal = regexp.MustCompile(compileAbuseWords(`иди идите пошел пошла пошли`).String() + `[\s,—–\-]+` + compileAbuseWords(`нахуй`).String())

var reportedAbuse = regexp.MustCompile(`(?:^|[^\p{L}])(?:фраза|фразу|фразы|фразе|слово|слова|термин|термина|цитата|цитате|цитирую|процитировал|процитировала|назвал|назвала|назвали|называют|обозвал|обозвала|обозвали|сказал|сказала|сказали|написал|написала|написали|оскорбление|оскорбления)(?:$|[^\p{L}])`)
var contrastAbuse = regexp.MustCompile(`[,;]\s*(?:но|а|однако|зато)\s+`)
var directedSuffix = regexp.MustCompile(`^[\s,—–-]*(?:ты|вы|он|она|они)(?:$|[^\p{L}])`)

func directlyAddressedWithMode(text string, start, end int, addressOnly bool) bool {
	prefix := text[:start]
	if i := strings.LastIndexAny(prefix, ".!?;\n"); i >= 0 {
		prefix = prefix[i+1:]
	}
	if contrasts := contrastAbuse.FindAllStringIndex(prefix, -1); len(contrasts) > 0 {
		prefix = prefix[contrasts[len(contrasts)-1][1]:]
	}
	if reportedAbuse.MatchString(prefix) {
		return false
	}
	if negatedPrefix.MatchString(prefix) {
		return false
	}
	if directedPrefix.MatchString(prefix) {
		return true
	}
	if directedSuffix.MatchString(text[end:]) && strings.TrimSpace(prefix) == "" {
		return true
	}
	if addressOnly {
		return false
	}
	// A bare insult is an abusive utterance; a quotation or discussion is not.
	trim := func(value string) string {
		return strings.TrimFunc(value, func(r rune) bool {
			return unicode.IsSpace(r) || unicode.IsSymbol(r) || strings.ContainsRune("!?.-,—0123456789", r)
		})
	}
	if trim(text[end:]) == "" && bareInsultPrefix.MatchString(strings.TrimSpace(text[:start])) {
		return true
	}
	return trim(text[:start]+text[end:]) == ""
}

// DetectProfanity is classification only. The caller applies the age policy.
// Detection must be retained even when adults may publish this vocabulary.
var profanityWords = compileAbuseWords(`х*й х*йня х**ня ху*ня х** п*зда пиз*ец бл*ть еб*ть хуй хуи хуя хуев хуем хуями хуйней хуйня хуйню хуйни хуйне хуйной хуйней хуйнями хуевый хуевая хуевые хуево хуев хули нахуй похуй похую охуеть охуел охуели охуевший охуенно охуенный охуительная пизда пизды пизду пизде пиздой пиздец пиздеть пиздит пиздят пиздюк пиздюки пиздато пиздатый пиздатая пиздатые пиздануть пиздовать пиздовал бляд блят блядь блять бля бляди блядский ебат ебать ебаться ебал ебала ебали ебало еблан ебланы ебли ебаный ебаная ебаные ебанутый ебанутая ебанутые ебучий ебучая ебучие ебнуть ебнул ебни заебал заебала заебали заебало заебись заебать выебал выебать выебу уебок уебки уебка уебков уеби уебать наебать наебал наебали наебка отъебись доебаться доебался съебать съебаться съебал съебись`)

// These longer obscene stems remain distinctive inside newly coined compounds.
// Do not expand the short "хуй" or "еб" stems this way: "страхуй" and
// "ребёнок" would become false positives. The ordinary dictionary handles them.
var compoundProfanityRoots = compileAbuseWords(`пизд хуе бляд`)

func compoundProfanitySpans(text string) [][2]int {
	spans := make([][2]int, 0)
	for _, match := range compoundProfanityRoots.FindAllStringIndex(text, -1) {
		start, end := match[0], match[1]
		for start > 0 {
			r, width := utf8.DecodeLastRuneInString(text[:start])
			if !wordRune(r) && r != '-' {
				break
			}
			start -= width
		}
		for end < len(text) {
			r, width := utf8.DecodeRuneInString(text[end:])
			if !wordRune(r) && r != '-' {
				break
			}
			end += width
		}
		spans = append(spans, [2]int{start, end})
	}
	return spans
}

func DetectProfanity(value string) bool {
	text := normalizedAbuseText(value)
	if len(compoundProfanitySpans(text)) > 0 {
		return true
	}
	for _, match := range profanityWords.FindAllStringIndex(text, -1) {
		before, _ := utf8.DecodeLastRuneInString(text[:match[0]])
		after, _ := utf8.DecodeRuneInString(text[match[1]:])
		if (match[0] == 0 || !wordRune(before)) && (match[1] == len(text) || !wordRune(after)) {
			return true
		}
	}
	return false
}

// A profanity score alone does not establish a human target. Used only to
// suppress ambiguous insult review for non-directed swearing, never threats.
func PossiblePersonalAbuse(value string) bool {
	text := normalizedAbuseText(value)
	for _, rule := range abuseRules {
		for _, m := range rule.pattern.FindAllStringIndex(text, -1) {
			before, _ := utf8.DecodeLastRuneInString(text[:m[0]])
			after, _ := utf8.DecodeRuneInString(text[m[1]:])
			if (m[0] == 0 || !wordRune(before)) && (m[1] == len(text) || !wordRune(after)) {
				return true
			}
		}
	}
	for _, w := range splitWords(text) {
		switch w {
		case "ты", "вы", "он", "она", "они", "тебя", "тебе", "вас", "вам", "человек", "люди", "урод", "тварь", "мразь":
			return true
		}
	}
	if strings.Contains(value, "@") {
		return true
	}
	for _, w := range strings.Fields(value) {
		first, _ := utf8.DecodeRuneInString(w)
		if unicode.IsUpper(first) && utf8.RuneCountInString(w) >= 3 && !DetectProfanity(w) {
			switch strings.ToLower(strings.Trim(w, ".,!?:;")) {
			case "это", "этот", "эта", "сегодня", "завтра", "вчера", "наконец", "какой", "какая":
				continue
			}
			return true
		}
	}
	return false
}

var directThreats = func() []*regexp.Regexp {
	phrases := []string{"я тебя убью", "я убью тебя", "я вас убью", "я убью вас", "я тебе сломаю руки", "сломаю тебе руки", "я подожгу твой дом", "я тебя зарежу", "я зарежу тебя", "я тебя изобью", "мы тебя изобьем", "мы вас убьем", "я тебя покалечу"}
	out := make([]*regexp.Regexp, 0, len(phrases))
	for _, phrase := range phrases {
		out = append(out, compileAbuseWords(strings.ReplaceAll(phrase, " ", "")))
	}
	return out
}()

func explicitDirectedThreat(text string) bool {
	for _, rule := range directThreats {
		for _, m := range rule.FindAllStringIndex(text, -1) {
			before, _ := utf8.DecodeLastRuneInString(text[:m[0]])
			after, _ := utf8.DecodeRuneInString(text[m[1]:])
			if (m[0] > 0 && wordRune(before)) || (m[1] < len(text) && wordRune(after)) {
				continue
			}
			prefix := text[:m[0]]
			if i := strings.LastIndexAny(prefix, ".!?\n"); i >= 0 {
				prefix = prefix[i+1:]
			}
			reported := false
			for _, cue := range []string{"цитат", "он сказал", "она сказала", "мне написали", "мне угрожают", "сообщение", "сообщении", "в фильме", "в игре"} {
				if strings.Contains(prefix, cue) {
					reported = true
				}
			}
			suffix := strings.TrimSpace(text[m[1]:])
			if strings.HasPrefix(suffix, "в игре") || strings.HasPrefix(suffix, "в фильме") {
				reported = true
			}
			if !reported {
				return true
			}
		}
	}
	return false
}

// Reader/author age classification is independent of whether a post is rejected.
func SensitiveLanguage(value string) bool {
	if DetectProfanity(value) {
		return true
	}
	text := normalizedAbuseText(value)
	for _, rule := range abuseRules {
		if rule.addressOnly {
			continue
		}
		for _, m := range rule.pattern.FindAllStringIndex(text, -1) {
			before, _ := utf8.DecodeLastRuneInString(text[:m[0]])
			after, _ := utf8.DecodeRuneInString(text[m[1]:])
			if (m[0] == 0 || !wordRune(before)) && (m[1] == len(text) || !wordRune(after)) {
				return true
			}
		}
	}
	return false
}
func reportedOrNegated(prefix string) bool {
	if i := strings.LastIndexAny(prefix, ".!?;\n"); i >= 0 {
		prefix = prefix[i+1:]
	}
	if matches := contrastAbuse.FindAllStringIndex(prefix, -1); len(matches) > 0 {
		prefix = prefix[matches[len(matches)-1][1]:]
	}
	return reportedAbuse.MatchString(prefix) || negatedPrefix.MatchString(prefix)
}
