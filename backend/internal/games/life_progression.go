package games

import (
	"fmt"
	"sort"
	"time"
)

type LifeProgressionState struct {
	XP                int64          `json:"xp"`
	Level             int            `json:"level"`
	PeakLevel         int            `json:"peak_level"`
	AwardedMilestones []string       `json:"awarded_milestones"`
	RepeatCounts      map[string]int `json:"repeat_counts"`
}

type LifeUnlockView struct {
	Level int    `json:"level"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
}

type LifeLevelView struct {
	Level          int              `json:"level"`
	XP             int64            `json:"xp"`
	LevelStartXP   int64            `json:"level_start_xp"`
	NextLevelXP    int64            `json:"next_level_xp"`
	Progress       int              `json:"progress"`
	Era            int              `json:"era"`
	EraID          string           `json:"era_id"`
	EraTitle       string           `json:"era_title"`
	EraDescription string           `json:"era_description"`
	Unlocked       []string         `json:"unlocked"`
	NextUnlock     string           `json:"next_unlock"`
	Upcoming       []LifeUnlockView `json:"upcoming"`
}

type lifeEraDef struct {
	Stage       int
	ID          string
	Title       string
	Description string
	Unlock      string
}

var lifeEraDefs = []lifeEraDef{
	{Stage:1, ID:"survival", Title:"Выживание", Description:"Еда, первые деньги, сон и любая доступная работа важнее статуса.", Unlock:"Подработки, базовый быт и первые жизненные события"},
	{Stage:2, ID:"foundation", Title:"Первые опоры", Description:"Нужно перестать начинать каждый день с нуля и подготовиться к учёбе.", Unlock:"Образование, первые квалификации и финансовая подушка"},
	{Stage:3, ID:"independence", Title:"Самостоятельность", Description:"Появляется постоянная работа, собственный бюджет и профессиональные связи.", Unlock:"Постоянная карьера, резерв и социальный капитал"},
	{Stage:4, ID:"profession", Title:"Профессия", Description:"Главная задача — стать ценным специалистом, а не просто отрабатывать смены.", Unlock:"Продвинутые вакансии, портфель и профессиональная специализация"},
	{Stage:5, ID:"expert", Title:"Сильный специалист", Description:"Доход уже позволяет выбирать между комфортом, капиталом и ускорением карьеры.", Unlock:"Серьёзное имущество, дорогие роли и управленческий трек"},
	{Stage:6, ID:"leader", Title:"Руководитель", Description:"Вы отвечаете не только за себя: люди, бюджеты и решения становятся частью жизни.", Unlock:"Высший менеджмент и подготовка к собственному бизнесу"},
	{Stage:7, ID:"founder", Title:"Предприниматель", Description:"Личная стабильность меняется на риск собственного дела, команды и продукта.", Unlock:"Компания, продукт, сооснователи и корпоративные финансы"},
	{Stage:8, ID:"big_business", Title:"Большой бизнес", Description:"Компания становится системой: отделы, сотни людей, рынки и сделки.", Unlock:"Национальный масштаб, M&A и сложная оргструктура"},
	{Stage:9, ID:"international", Title:"Международный бизнес", Description:"Решения измеряются уже рынками, миллиардами и тысячами сотрудников.", Unlock:"Международные рынки, IPO и глобальное финансирование"},
	{Stage:10, ID:"global", Title:"Глобальная корпорация", Description:"ТНК — не конец игры, а начало бесконечного endgame владельца глобального бизнеса.", Unlock:"Совет директоров, глобальные кризисы и бесконечный корпоративный endgame"},
}

func lifeXPForLevel(level int) int64 {
	if level <= 1 { return 0 }
	if level > 100 { level = 100 }
	n := int64(level - 1)
	return 50 * n * n
}

func lifeLevelFromXP(xp int64) int {
	level := 1
	for next := 2; next <= 100; next++ {
		if xp < lifeXPForLevel(next) { break }
		level = next
	}
	return level
}

func lifeEraForLevel(level int) lifeEraDef {
	stage := (max(1, min(100, level))-1)/10 + 1
	return lifeEraDefs[stage-1]
}

func normalizeLifeProgression(st *LifeState) {
	if st.Progression.RepeatCounts == nil {
		st.Progression.RepeatCounts = map[string]int{}
	}
	if st.Progression.AwardedMilestones == nil {
		st.Progression.AwardedMilestones = []string{}
	}
	if st.Progression.Level <= 0 {
		st.Progression.Level = 1
	}
	lifeSyncMilestoneXP(st)
	level := lifeLevelFromXP(st.Progression.XP)
	if level > st.Progression.Level { st.Progression.Level = level }
	if st.Progression.Level > st.Progression.PeakLevel { st.Progression.PeakLevel = st.Progression.Level }
}

func lifeHasMilestoneAward(st *LifeState, id string) bool {
	for _, old := range st.Progression.AwardedMilestones {
		if old == id { return true }
	}
	return false
}

func lifeSyncMilestoneXP(st *LifeState) {
	for _, milestone := range lifeMilestones(*st) {
		if !milestone.Done || lifeHasMilestoneAward(st, milestone.ID) { continue }
		bonus := int64(milestone.Stage * milestone.Stage * 500)
		st.Progression.XP += bonus
		st.Progression.AwardedMilestones = append(st.Progression.AwardedMilestones, milestone.ID)
	}
	level := lifeLevelFromXP(st.Progression.XP)
	if level > st.Progression.Level {
		st.Progression.Level = level
	}
	if st.Progression.Level > st.Progression.PeakLevel {
		st.Progression.PeakLevel = st.Progression.Level
	}
}

func lifeAwardXP(st *LifeState, amount int64) {
	if amount <= 0 { return }
	st.Progression.XP += amount
	level := lifeLevelFromXP(st.Progression.XP)
	if level > st.Progression.Level {
		st.Progression.Level = level
	}
	if st.Progression.Level > st.Progression.PeakLevel {
		st.Progression.PeakLevel = st.Progression.Level
	}
}

func lifeAwardRepeatXP(st *LifeState, key string, base int64) {
	if base <= 0 { return }
	if st.Progression.RepeatCounts == nil {
		st.Progression.RepeatCounts = map[string]int{}
	}
	count := st.Progression.RepeatCounts[key]
	divisor := int64(1 + count/6)
	amount := base / divisor
	if floor := base / 5; amount < floor { amount = floor }
	if amount < 1 { amount = 1 }
	st.Progression.RepeatCounts[key] = count + 1
	lifeAwardXP(st, amount)
}

func lifeAwardActivityXP(st *LifeState, a LifeActivity) {
	switch a.Kind {
	case "job":
		lifeAwardRepeatXP(st, "job:"+a.Target, 25+int64(a.ExperienceGain*12))
	case "study":
		lifeAwardXP(st, int64(500+max(1, a.EducationLevel)*650))
	case "train":
		lifeAwardRepeatXP(st, "train:"+a.Target, 70)
	case "rest":
		lifeAwardRepeatXP(st, "rest", 8)
	case "career_interview":
		lifeAwardRepeatXP(st, "interview:"+a.Target, 65)
	case "career_month":
		lifeAwardRepeatXP(st, "career:"+a.Target, 130)
	case "hobby":
		lifeAwardRepeatXP(st, "hobby:"+a.Target, 28)
	case "social":
		lifeAwardRepeatXP(st, "social:"+a.Target, 25)
	case "certification":
		lifeAwardXP(st, 260)
	case "business_cycle":
		tier := 1
		if st.Company != nil { tier = max(1, st.Company.Tier) }
		lifeAwardRepeatXP(st, fmt.Sprintf("business-cycle:%d:%s", tier, a.Target), int64(130*tier))
	case "business_expand":
		lifeAwardXP(st, int64(800*max(1, a.TargetLevel)))
	case "business_product":
		tier := 1
		if st.Company != nil { tier = max(1, st.Company.Tier) }
		lifeAwardRepeatXP(st, "product:"+a.Target, int64(180*tier))
	case "business_region":
		tier := 1
		if st.Company != nil { tier = max(1, st.Company.Tier) }
		lifeAwardXP(st, int64(450*tier))
	}
}

func lifeUpcomingUnlocks(level int) []LifeUnlockView {
	var all []LifeUnlockView
	for i := 1; i < len(lifeEraDefs); i++ {
		unlockLevel := i*10 + 1
		if unlockLevel > level {
			all = append(all, LifeUnlockView{Level:unlockLevel, Kind:"era", Title:lifeEraDefs[i].Title})
		}
	}
	seenCareer := map[string]bool{}
	for _, role := range lifeCareerOptions {
		required := lifeCareerRequiredLevel(role)
		if required <= level || seenCareer[role.Title] { continue }
		seenCareer[role.Title] = true
		all = append(all, LifeUnlockView{Level:required, Kind:"career", Title:role.Title})
	}
	for _, tier := range lifeBusinessTiers {
		if tier.MinLevel <= level { continue }
		all = append(all, LifeUnlockView{Level:tier.MinLevel, Kind:"business", Title:tier.Title})
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].Level == all[j].Level { return all[i].Kind < all[j].Kind }
		return all[i].Level < all[j].Level
	})
	if len(all) > 6 { all = all[:6] }
	return all
}

func lifeLevelView(st LifeState) LifeLevelView {
	normalizeLifeProgression(&st)
	level := st.Progression.Level
	era := lifeEraForLevel(level)
	start := lifeXPForLevel(level)
	next := lifeXPForLevel(min(100, level+1))
	progress := 100
	if level < 100 && next > start {
		progress = int((st.Progression.XP - start) * 100 / (next - start))
		progress = max(0, min(100, progress))
	}
	unlocked := []string{lifeEraDefs[0].Unlock}
	for i := 1; i < len(lifeEraDefs); i++ {
		if level < i*10+1 { break }
		unlocked = append(unlocked, lifeEraDefs[i].Unlock)
	}
	nextUnlock := "Все основные жизненные системы открыты"
	if era.Stage < 10 {
		nextUnlock = fmt.Sprintf("Уровень %d: %s", era.Stage*10+1, lifeEraDefs[era.Stage].Unlock)
	}
	return LifeLevelView{
		Level:level,
		XP:st.Progression.XP,
		LevelStartXP:start,
		NextLevelXP:next,
		Progress:progress,
		Era:era.Stage,
		EraID:era.ID,
		EraTitle:era.Title,
		EraDescription:era.Description,
		Unlocked:unlocked,
		NextUnlock:nextUnlock,
		Upcoming:lifeUpcomingUnlocks(level),
	}
}

func lifeLevel(st *LifeState) int {
	normalizeLifeProgression(st)
	return st.Progression.Level
}


func lifeFinalizeState(st *LifeState, now time.Time, allowStory bool) {
	normalizeLifeProgression(st)
	normalizeLifeStory(st)
	lifeSyncMilestoneXP(st)
	if allowStory && st.PendingEvent == nil && st.Active == nil {
		maybeLifeStory(st, now)
	}
}
