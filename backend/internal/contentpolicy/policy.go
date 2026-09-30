package contentpolicy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

type Violation struct{ Category string }

var ErrAnalysisUnavailable = errors.New("content analysis temporarily unavailable")

func (v *Violation) Error() string { return "content policy: " + v.Category }

func (v *Violation) UserMessage() string {
	switch v.Category {
	case "public_profanity":
		return "Мат допустим только в публикациях и комментариях 18+. Это поле видно всем возрастам."
	case "profanity_underage":
		return "Публикации с матом доступны только с 18 лет. Проверьте дату рождения или измените текст."
	case "politics":
		return "Политические темы не допускаются правилами сообщества. Измените текст."
	case "sexual":
		return "Эротический и порнографический контент не допускается. Измените текст."
	case "obscenity":
		return "Прямые оскорбления не допускаются. Измените текст."
	case "insult":
		return "Оскорбления не допускаются правилами сообщества. Измените текст."
	case "threat":
		return "Угрозы и призывы к насилию не допускаются. Измените текст."
	case "hate":
		return "Язык ненависти и травля не допускаются. Измените текст."
	case "extremism":
		return "Пропаганда экстремизма и нацизма не допускается. Измените текст."
	case "fraud":
		return "Мошеннические предложения не допускаются. Измените текст."
	case "spam":
		return "Спам не допускается. Измените текст."
	default:
		return "Запрещённый контент не допускается. Измените текст."
	}
}

type checker struct {
	url    string
	mode   string
	client *http.Client
}

type aiResponse struct {
	Model       string             `json:"model"`
	Version     string             `json:"version"`
	Scores      map[string]float64 `json:"scores"`
	Flags       []string           `json:"flags"`
	ReviewFlags []string           `json:"review_flags"`
	Truncated   bool               `json:"truncated"`
	Complete    *bool              `json:"complete,omitempty"`
}

var aiState struct {
	sync.RWMutex
	checker *checker
}

type DiscussionAnalysis struct {
	AdultOnly bool
	Review    []string
}

type discussionAnalysisContextKey struct{}

type cachedDiscussionAnalysis struct {
	text     string
	analysis DiscussionAnalysis
}

func WithDiscussionAnalysis(ctx context.Context, text string, analysis DiscussionAnalysis) context.Context {
	copyOfAnalysis := DiscussionAnalysis{AdultOnly: analysis.AdultOnly, Review: append([]string(nil), analysis.Review...)}
	return context.WithValue(ctx, discussionAnalysisContextKey{}, cachedDiscussionAnalysis{text: text, analysis: copyOfAnalysis})
}

func DiscussionAnalysisFromContext(ctx context.Context, text string) (DiscussionAnalysis, bool) {
	cached, ok := ctx.Value(discussionAnalysisContextKey{}).(cachedDiscussionAnalysis)
	if !ok || cached.text != text {
		return DiscussionAnalysis{}, false
	}
	cached.analysis.Review = append([]string(nil), cached.analysis.Review...)
	return cached.analysis, true
}

func Configure(url, mode string) {
	url = strings.TrimSpace(url)
	mode = strings.ToLower(strings.TrimSpace(mode))
	aiState.Lock()
	defer aiState.Unlock()
	if url == "" || mode == "" || mode == "off" {
		aiState.checker = nil
		return
	}
	aiState.checker = &checker{
		url:    url,
		mode:   mode,
		client: &http.Client{Timeout: 3 * time.Second},
	}
}

// CheckTextLocal preserves cheap text rules while post AI runs in the durable queue.
func CheckTextLocal(values ...string) error {
	if err := CheckObviousText(values...); err != nil {
		return err
	}
	for _, value := range values {
		if err := checkHardRules(strings.TrimSpace(value)); err != nil {
			return err
		}
	}
	return checkLegacyRules(values...)
}

// Public profile/event metadata is visible to all ages and has no adult-only gate.
func CheckText(ctx context.Context, values ...string) error {
	for _, value := range values {
		if DetectProfanity(value) {
			return &Violation{Category: "public_profanity"}
		}
		// A benign biography must not negate an abusive name or username.
		if err := CheckDiscussionText(ctx, value); err != nil {
			return err
		}
	}
	return nil
}

// Posts/comments enforce age separately in their persistence and read paths.
func CheckDiscussionText(ctx context.Context, values ...string) error {
	_, err := AnalyzeDiscussionText(ctx, values...)
	return err
}

// AnalyzeDiscussionText applies deterministic rules first, then V19.
// High-confidence signals block; lower-confidence signals are returned for review.
func AnalyzeDiscussionText(ctx context.Context, values ...string) (DiscussionAnalysis, error) {
	analysis := DiscussionAnalysis{}
	if err := CheckCommentText(values...); err != nil {
		return analysis, err
	}
	texts := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if err := checkHardRules(value); err != nil {
			return analysis, err
		}
		analysis.AdultOnly = analysis.AdultOnly || SensitiveLanguage(value)
		texts = append(texts, normalizeForModel(value))
	}
	if len(texts) == 0 {
		return analysis, nil
	}

	aiState.RLock()
	active := aiState.checker
	aiState.RUnlock()
	if active == nil {
		if err := checkLegacyRules(values...); err != nil {
			return analysis, err
		}
		return analysis, nil
	}

	result, err := active.analyze(ctx, strings.Join(texts, "\n"))
	if err != nil {
		if localErr := checkLegacyRules(values...); localErr != nil {
			return analysis, localErr
		}
		if active.mode == "enforce" {
			return analysis, ErrAnalysisUnavailable
		}
		return analysis, nil
	}
	if active.mode == "shadow" {
		return analysis, nil
	}

	analysis.AdultOnly = analysis.AdultOnly || result.Scores["profanity"] >= 0.9 || result.Scores["obscenity"] >= 0.9
	if result.Version == SafetyVersion {
		if blocked := SafetyBlockCategories(result.Scores); len(blocked) > 0 {
			return analysis, &Violation{Category: blocked[0]}
		}
	} else {
		for _, flag := range result.Flags {
			if category := categoryForFlag(flag); category != "" {
				return analysis, &Violation{Category: category}
			}
		}
	}

	seen := map[string]bool{}
	for _, flag := range result.ReviewFlags {
		category := ""
		if result.Version == SafetyVersion {
			category = SafetyCategory(flag)
		}
		if category == "" {
			category = categoryForFlag(flag)
		}
		if category != "" && !seen[category] {
			seen[category] = true
			analysis.Review = append(analysis.Review, category)
		}
	}

	if strings.HasPrefix(result.Model, "rubert-tiny-toxicity") {
		if err := checkLegacyRules(values...); err != nil {
			return analysis, err
		}
	}
	return analysis, nil
}

func (c *checker) analyze(ctx context.Context, text string) (aiResponse, error) {
	result, err := c.analyzePart(ctx, text)
	if err != nil || !result.Truncated {
		return result, err
	}
	runes := []rune(text)
	if len(runes) < 2 {
		return aiResponse{}, io.ErrUnexpectedEOF
	}
	middle := len(runes) / 2
	overlap := 0
	if len(runes) > 64 {
		overlap = 16
	}
	left, err := c.analyze(ctx, string(runes[:middle+overlap]))
	if err != nil {
		return aiResponse{}, err
	}
	right, err := c.analyze(ctx, string(runes[middle-overlap:]))
	if err != nil {
		return aiResponse{}, err
	}
	if left.Version != right.Version {
		return aiResponse{}, io.ErrUnexpectedEOF
	}
	for k, v := range right.Scores {
		if v > left.Scores[k] {
			left.Scores[k] = v
		}
	}
	left.Flags = append(left.Flags, right.Flags...)
	left.ReviewFlags = append(left.ReviewFlags, right.ReviewFlags...)
	left.Truncated = false
	return left, nil
}
func (c *checker) analyzePart(ctx context.Context, text string) (aiResponse, error) {
	payload, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return aiResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(payload))
	if err != nil {
		return aiResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return aiResponse{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return aiResponse{}, io.ErrUnexpectedEOF
	}
	var result aiResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result); err != nil {
		return aiResponse{}, err
	}
	if result.Version == "" || len(result.Scores) == 0 || (result.Complete != nil && !*result.Complete) ||
		(result.Version == SafetyVersion && result.Complete == nil) {
		return aiResponse{}, io.ErrUnexpectedEOF
	}
	for _, score := range result.Scores {
		if math.IsNaN(score) || math.IsInf(score, 0) || score < 0 || score > 1 {
			return aiResponse{}, io.ErrUnexpectedEOF
		}
	}
	return result, nil
}

func categoryForFlag(flag string) string {
	switch flag {
	case "profanity", "obscenity", "obscene", "insult":
		// Profanity is allowed; model insult scores cannot establish a direct target.
		return ""
	case "threat", "violence":
		return "threat"
	case "hate":
		return "hate"
	case "sexual":
		return "sexual"
	case "extremism":
		return "extremism"
	case "politics":
		return "politics"
	case "fraud":
		return "fraud"
	case "spam":
		return "spam"
	case "illicit", "drug_abuse", "animal_cruelty":
		return "prohibited"
	default:
		return ""
	}
}

func checkHardRules(value string) error {
	if err := checkEncodedPolicy(value); err != nil {
		return err
	}
	words := splitWords(value)
	if len(words) == 0 {
		return nil
	}
	normalized := normalizeForModel(value)
	offset := 0
	for i, word := range words {
		position := strings.Index(normalized[offset:], word) + offset
		if position >= offset {
			offset = position + len(word)
			if reportedOrNegated(normalizedAbuseText(normalized[:position])) {
				continue
			}
		}
		if hasPrefix(word, narcoticTerms) && hasNearbyWord(words, i, 5, transactionTerms) {
			return &Violation{Category: "prohibited"}
		}
		if hasPrefix(word, violenceTerms) && hasNearbyWord(words, i, 6, humanOrPlaceTargets) &&
			(hasNearbyWord(words, i, 5, incitementTerms) || hasPrefix(word, imperativeViolenceTerms)) {
			return &Violation{Category: "threat"}
		}
		if hasPrefix(word, extremistTerms) &&
			hasNearbyWord(words, i, 5, extremistPromotionTerms) &&
			!negatedExtremistPromotion(words, i) &&
			!hasNearbyWord(words, i, 6, contextualTerms) {
			return &Violation{Category: "extremism"}
		}
	}
	return nil
}

func checkLegacyRules(values ...string) error {
	for _, value := range values {
		words := splitWords(value)
		for i, word := range words {
			if hasPrefix(word, politicalTerms) && !nonPoliticalPolicy(words, i) {
				return &Violation{Category: "politics"}
			}
			if hasPrefix(word, sexualTerms) {
				return &Violation{Category: "sexual"}
			}
		}
	}
	return nil
}

var politicalTerms = []string{
	"политик", "политичес", "предвыбор", "избирател", "митинг", "президент",
	"депутат", "госдум", "агитац", "парламент", "протест", "выборы", "выборах", "избирком",
	"геополит", "референдум", "оппозиц", "единоросс", "коммунистическ", "либеральнодемократ", "импичмент", "правительств", "предвыборн", "санкционн",
}

var sexualTerms = []string{
	"эротик", "эротичес", "порн", "нюдс", "интим", "сексуал", "обнажен", "проституц",
}

var narcoticTerms = []string{
	"наркотик", "мефедрон", "героин", "кокаин", "амфетамин", "марихуан", "гашиш", "метамфетамин",
}

var transactionTerms = []string{
	"продам", "продаю", "продажа", "купить", "куплю", "покупай", "закажи", "заказ", "доставк", "сбыт", "закладк",
}

var violenceTerms = []string{
	"убить", "убьем", "убей", "уничтожить", "взорвать", "взорви", "поджечь", "подожги", "избить", "расправиться",
}

var imperativeViolenceTerms = []string{"убей", "взорви", "подожги"}

var incitementTerms = []string{
	"давайте", "надо", "нужно", "пора", "призываю", "требую", "планируем", "следует",
}

var humanOrPlaceTargets = []string{
	"людей", "человек", "детей", "ребят", "женщин", "мужчин", "граждан", "мигрант", "иностранц",
	"участник", "посетител", "школ", "больниц", "дом", "здание", "администрац", "полицейск",
}

var extremistTerms = []string{
	"нацист", "неонацист", "фашист", "экстремист", "террорист",
}

var extremistPromotionTerms = []string{
	"поддерж", "пропаганд", "агит", "вступ", "верб", "присоедин", "финанс", "донат", "одобря", "симпат", "слава",
}

var contextualTerms = []string{
	"против", "борьб", "осуд", "истори", "музе", "новост", "запрещ", "суд", "исслед", "лекци", "книг", "фильм",
}

func normalizeForModel(value string) string {
	value = norm.NFKC.String(strings.ToLower(value))
	var result strings.Builder
	result.Grow(len(value))
	for _, r := range value {
		switch r {
		case '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff':
			continue
		case 'ё':
			r = 'е'
		}
		result.WriteRune(r)
	}
	return result.String()
}

func splitWords(value string) []string {
	value = normalizeForModel(value)
	return strings.FieldsFunc(value, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
}

func hasPrefix(word string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(word, prefix) {
			return true
		}
	}
	return false
}

func hasNearbyWord(words []string, index, radius int, prefixes []string) bool {
	start := index - radius
	if start < 0 {
		start = 0
	}
	end := index + radius + 1
	if end > len(words) {
		end = len(words)
	}
	for position := start; position < end; position++ {
		if position != index && hasPrefix(words[position], prefixes) {
			return true
		}
	}
	return false
}

func negatedExtremistPromotion(words []string, index int) bool {
	start, end := index-5, index+6
	if start < 0 {
		start = 0
	}
	if end > len(words) {
		end = len(words)
	}
	negated := false
	for i := start; i < end; i++ {
		if !hasPrefix(words[i], extremistPromotionTerms) {
			continue
		}
		if i == 0 || (words[i-1] != "не" && words[i-1] != "никогда") {
			return false
		}
		negated = true
	}
	return negated
}

// Consumer/business policies are not political discussion.
func nonPoliticalPolicy(words []string, i int) bool {
	if strings.HasPrefix(words[i], "президент") {
		return hasNearbyWord(words, i, 3, []string{"спортивн", "клуб", "компани", "федераци", "ассоциаци"})
	}
	if hasPrefix(words[i], []string{"выборы", "выборах"}) {
		return hasNearbyWord(words, i, 3, []string{"капитан", "команд", "старост"})
	}
	if !strings.HasPrefix(words[i], "политик") {
		return false
	}
	return hasNearbyWord(words, i, 3, []string{"конфиденциальност", "персональн", "обработк", "доставк", "возврат", "магазин", "ценов", "кадров", "учетн", "компани", "предприят"})
}
