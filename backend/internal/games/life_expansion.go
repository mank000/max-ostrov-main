package games

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type LifeCareerState struct {
	RoleID      string `json:"role_id"`
	Title       string `json:"title"`
	Track       string `json:"track"`
	Employer    string `json:"employer"`
	Salary      int64  `json:"salary"`
	Performance int    `json:"performance"`
	Stability   int    `json:"stability"`
	Months      int    `json:"months"`
	LastSalary  int64  `json:"last_salary"`
}

type LifeFinanceState struct {
	Savings       int64            `json:"savings"`
	CreditScore   int              `json:"credit_score"`
	Portfolio     map[string]int64 `json:"portfolio"`
	TotalInvested int64            `json:"total_invested"`
	TaxesPaid     int64            `json:"taxes_paid"`
	Insurance     int              `json:"insurance"`
	LastReturn    int64            `json:"last_return"`
}

type LifeLifestyleState struct {
	Stress      int      `json:"stress"`
	Fitness     int      `json:"fitness"`
	Social      int      `json:"social"`
	Knowledge   int      `json:"knowledge"`
	Comfort     int      `json:"comfort"`
	HabitStreak int      `json:"habit_streak"`
	Assets      []string `json:"assets"`
	EquippedWardrobe string `json:"equipped_wardrobe,omitempty"`
	Credentials []string `json:"credentials"`
}

type LifeNetworkState struct {
	Friends              int `json:"friends"`
	ProfessionalContacts int `json:"professional_contacts"`
	Mentors              int `json:"mentors"`
	Relationship         int `json:"relationship"`
	FamilyBond           int `json:"family_bond"`
}

type LifeEconomyState struct {
	Phase       string `json:"phase"`
	MarketIndex int    `json:"market_index"`
	Inflation   int    `json:"inflation"`
	LastDay     int    `json:"last_day"`
}

type LifeCompanyProductState struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Quality    int    `json:"quality"`
	MarketFit  int    `json:"market_fit"`
	Revenue    int64  `json:"revenue"`
	Launches   int    `json:"launches"`
	LastResult string `json:"last_result"`
}

func normalizeLifeExpansion(st *LifeState) {
	legacyV2 := st.Version < 2
	legacyV3 := st.Version < 3
	if st.MaxHome < st.Home { st.MaxHome = st.Home }
	if st.Finance.CreditScore == 0 {
		st.Finance.CreditScore = 560
	}
	if st.Finance.Portfolio == nil {
		st.Finance.Portfolio = map[string]int64{}
	}
	if legacyV2 || st.Lifestyle.Fitness == 0 && st.Lifestyle.Social == 0 && st.Lifestyle.Knowledge == 0 && st.Lifestyle.Stress == 0 && st.Lifestyle.Comfort == 0 && len(st.Lifestyle.Assets) == 0 && len(st.Lifestyle.Credentials) == 0 {
		st.Lifestyle = LifeLifestyleState{
			Stress: 18, Fitness: 34, Social: 24, Knowledge: 12, Comfort: 8,
			Assets: []string{},
		}
	}
	if st.Lifestyle.Assets == nil {
		st.Lifestyle.Assets = []string{}
	}
	if st.Lifestyle.Credentials == nil {
		st.Lifestyle.Credentials = []string{}
	}
	if legacyV2 && st.Network.FamilyBond == 0 {
		st.Network.FamilyBond = 50
	}
	if st.Economy.Phase == "" {
		st.Economy = LifeEconomyState{Phase:"normal", MarketIndex:100, Inflation:4, LastDay:st.Days}
	}
	if st.Company != nil {
		if st.Company.Industry == "" {
			st.Company.Industry = "services"
		}
		if st.Company.Departments == nil {
			st.Company.Departments = map[string]int{}
		}
		if st.Company.Regions == nil {
			st.Company.Regions = []string{"home"}
		}
		if st.Company.Products == nil {
			st.Company.Products = []LifeCompanyProductState{}
		}
		if st.Company.Ownership == 0 {
			st.Company.Ownership = 100
		}
		if st.Company.Valuation == 0 {
			st.Company.Valuation = max(int64(100_000), st.Company.Cash*3)
		}
	}
	normalizeLifeProgression(st)
	normalizeLifeStory(st)
	if legacyV3 && st.Version < 3 {
		st.Version = 3
	}
}

func ownedLifeAsset(st *LifeState, id string) bool {
	for _, owned := range st.Lifestyle.Assets {
		if owned == id { return true }
	}
	return false
}

func hasLifeTransport(st *LifeState) bool {
	for _, id := range st.Lifestyle.Assets {
		if asset, ok := findLifeAsset(id); ok && asset.Category == "transport" {
			return true
		}
	}
	return false
}

func lifeAssetBonuses(st *LifeState) (energy, mood, work, status int) {
	for _, id := range st.Lifestyle.Assets {
		if asset, ok := findLifeAsset(id); ok {
			energy += asset.EnergyBonus
			mood += asset.MoodBonus
			work += asset.WorkBonus
			status += asset.StatusBonus
		}
	}
	return
}

func lifeCareerReadiness(st *LifeState, role LifeCareerOption) int {
	score := 52
	score += min(18, max(0, st.Experience-role.MinExperience)/2)
	score += min(10, max(0, st.Reputation-role.MinReputation))
	score += min(8, st.Lifestyle.Social/12)
	score += min(8, st.Network.ProfessionalContacts/5)
	score += min(6, st.Network.Mentors*2)
	score += min(5, st.Lifestyle.Knowledge/20)
	score += min(8, lifeLevel(st)/12)
	path := lifeStoryChoice(st, "career_identity")
	if path == "expert" && (role.Track == "tech" || role.Track == "data" || role.Track == "finance") {
		score += 6
	}
	if path == "manager" && (role.Track == "management" || role.Track == "operations" || role.Track == "sales") {
		score += 6
	}
	_, _, workBonus, statusBonus := lifeAssetBonuses(st)
	score += workBonus + statusBonus + min(8, len(st.Lifestyle.Credentials))
	if st.Lifestyle.Stress > 75 { score -= 10 }
	if st.Mood < 25 { score -= 6 }
	return max(15, min(92, score))
}

func canApplyLifeCareer(st *LifeState, role LifeCareerOption) bool {
	return st.Education >= role.MinEducation &&
		st.Experience >= role.MinExperience &&
		st.Reputation >= role.MinReputation &&
		meetsLifeSkills(st.Skills, role.MinSkills)
}

func (s *Service) lifeCareerApply(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	role, ok := findLifeCareer(id)
	if !ok { return ErrInput }
	if !canApplyLifeCareer(st, role) || lifeLevel(st) < role.MinLevel { return ErrLifeLocked }
	if st.Energy < 18 || st.Hunger < 14 { return ErrLifeNeeds }
	return startLifeActivity(st, now, time.Duration(role.InterviewSeconds)*time.Second, LifeActivity{
		Kind:"career_interview", Target:id, Title:"Собеседование: "+role.Title, GameDays:2, HungerCost:4, EnergyCost:8,
	})
}

func lifeEmployerName(track string) string {
	names := map[string][]string{
		"tech":{"Northstack","Pixel Forge","Cloud Axis","Nova Systems"},
		"data":{"Metric Lab","Signal Group","Atlas Data","Vector Research"},
		"sales":{"Marketline","Prime Trade","Orbit Commerce","Bridge Group"},
		"finance":{"Capital Core","Ledger House","North Finance","Axiom Partners"},
		"management":{"Forward Labs","Project One","Scale Works","Union Products"},
		"operations":{"City Retail","Everyday Group","Route Market","Urban Service"},
	}
	values := names[track]
	if len(values) == 0 { values = []string{"Progress Group"} }
	return values[random(len(values))]
}

func (s *Service) finishLifeCareerInterview(st *LifeState, a LifeActivity, now time.Time) {
	role, ok := findLifeCareer(a.Target)
	if !ok { return }
	chance := lifeCareerReadiness(st, role)
	if random(100) >= chance {
		st.Mood = clampLife(st.Mood - 4)
		st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 4)
		st.Network.ProfessionalContacts++
		lifeHistory(st, now, "career", "Собеседование без оффера", fmt.Sprintf("%s: компания выбрала другого кандидата. Шанс оффера был около %d%%.", role.Title, chance))
		return
	}
	st.Career = &LifeCareerState{
		RoleID:role.ID, Title:role.Title, Track:role.Track, Employer:lifeEmployerName(role.Track),
		Salary:role.Salary, Performance:58, Stability:72,
	}
	st.Reputation = clampLife(st.Reputation + 2)
	st.Network.ProfessionalContacts += 2
	st.Mood = clampLife(st.Mood + 5)
	lifeHistory(st, now, "career", "Получен оффер", fmt.Sprintf("%s · %s · %d ₽ в месяц.", st.Career.Employer, role.Title, role.Salary))
}

func (s *Service) lifeCareerWork(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Career == nil { return ErrLifeLocked }
	role, ok := findLifeCareer(st.Career.RoleID)
	if !ok { return ErrLifeLocked }
	if st.Energy < 25 || st.Hunger < 18 || st.Health < 24 { return ErrLifeNeeds }
	return startLifeActivity(st, now, time.Duration(role.WorkSeconds)*time.Second, LifeActivity{
		Kind:"career_month", Target:role.ID, Title:"Рабочий месяц: "+role.Title, GameDays:30, HungerCost:14, EnergyCost:26,
	})
}

func (s *Service) finishLifeCareerMonth(st *LifeState, a LifeActivity, now time.Time) {
	if st.Career == nil || st.Career.RoleID != a.Target { return }
	role, ok := findLifeCareer(a.Target)
	if !ok { return }

	_, _, workBonus, _ := lifeAssetBonuses(st)
	performanceChange := random(15) - 6 + workBonus/2
	performanceChange += (st.Mood-50)/20
	performanceChange -= max(0, st.Lifestyle.Stress-60)/8
	st.Career.Performance = clampLife(st.Career.Performance + performanceChange)
	st.Career.Months++
	stabilityChange := (st.Career.Performance - 50) / 15
	if st.Economy.Phase == "recession" { stabilityChange -= 6 }
	if st.Economy.Phase == "slowdown" { stabilityChange -= 3 }
	if st.Economy.Phase == "growth" || st.Economy.Phase == "boom" { stabilityChange += 2 }
	st.Career.Stability = clampLife(st.Career.Stability + stabilityChange)

	gross := role.Salary
	if st.Career.Performance >= 85 { gross += role.Salary/8 }
	if st.Career.Performance <= 25 { gross -= role.Salary/10 }
	tax := gross * 12 / 100
	net := gross - tax
	st.Cash += net
	st.TotalEarned += net
	st.Finance.TaxesPaid += tax
	st.Career.LastSalary = net
	st.Experience += 3 + role.MinEducation
	st.Reputation = clampLife(st.Reputation + 1)
	st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 7 + role.MinEducation*2)
	st.Lifestyle.Knowledge = clampLife(st.Lifestyle.Knowledge + 1)
	st.Network.ProfessionalContacts += 1
	if st.Network.Mentors > 0 && st.Career.Months%3 == 0 {
		st.Skills.Management = clampLife(st.Skills.Management + min(2, st.Network.Mentors))
		st.Skills.Communication = clampLife(st.Skills.Communication + 1)
	}

	if (st.Career.Performance < 18 || st.Career.Stability < 15) && random(100) < 45 {
		title := st.Career.Title
		st.Career = nil
		st.Mood = clampLife(st.Mood - 12)
		st.Reputation = clampLife(st.Reputation - 2)
		lifeHistory(st, now, "career", "Вы потеряли работу", "Низкая результативность привела к увольнению с позиции «"+title+"».")
		return
	}
	if st.Career.Performance >= 82 && random(100) < 18 {
		bonus := gross / 3
		st.Cash += bonus
		st.TotalEarned += bonus
		st.Reputation = clampLife(st.Reputation + 2)
		lifeHistory(st, now, "career", "Премия за сильный месяц", fmt.Sprintf("+%d ₽ к зарплате.", bonus))
		return
	}
	lifeHistory(st, now, "career", "Зарплата получена", fmt.Sprintf("%d ₽ после игрового налога · результативность %d/100.", net, st.Career.Performance))
}

func (s *Service) lifeCareerQuit(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Career == nil { return ErrLifeLocked }
	title := st.Career.Title
	st.Career = nil
	st.Mood = clampLife(st.Mood + 2)
	lifeHistory(st, now, "career", "Вы ушли с работы", title)
	return nil
}

func (s *Service) lifeAssetBuy(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	asset, ok := findLifeAsset(id)
	if !ok { return ErrInput }
	if ownedLifeAsset(st, id) { return ErrLifeLocked }
	if st.Cash < asset.Cost { return ErrLifeFunds }
	st.Cash -= asset.Cost
	st.Lifestyle.Assets = append(st.Lifestyle.Assets, id)
	if asset.Category == "wardrobe" { st.Lifestyle.EquippedWardrobe = id }
	st.Lifestyle.Comfort = clampLife(st.Lifestyle.Comfort + asset.EnergyBonus + asset.MoodBonus)
	st.Mood = clampLife(st.Mood + asset.MoodBonus)
	st.Reputation = clampLife(st.Reputation + asset.StatusBonus)
	lifeHistory(st, now, "asset", "Покупка", asset.Title)
	return nil
}

func (s *Service) lifeWardrobeEquip(st *LifeState, id string) error {
	if id == "casual" {
		st.Lifestyle.EquippedWardrobe = id
		return nil
	}
	asset, ok := findLifeAsset(id)
	if !ok || asset.Category != "wardrobe" || !ownedLifeAsset(st, id) { return ErrLifeLocked }
	st.Lifestyle.EquippedWardrobe = id
	return nil
}

func (s *Service) lifeHobbyStart(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	hobby, ok := findLifeHobby(id)
	if !ok { return ErrInput }
	if st.Cash < hobby.Cost { return ErrLifeFunds }
	if st.Energy < 12 || st.Hunger < 10 { return ErrLifeNeeds }
	st.Cash -= hobby.Cost
	return startLifeActivity(st, now, time.Duration(hobby.DurationSeconds)*time.Second, LifeActivity{
		Kind:"hobby", Target:id, Title:hobby.Title, GameDays:hobby.GameDays, HungerCost:4, EnergyCost:5,
	})
}

func (s *Service) finishLifeHobby(st *LifeState, a LifeActivity, now time.Time) {
	hobby, ok := findLifeHobby(a.Target)
	if !ok { return }
	st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + hobby.StressChange)
	st.Lifestyle.Fitness = clampLife(st.Lifestyle.Fitness + hobby.FitnessChange)
	st.Lifestyle.Social = clampLife(st.Lifestyle.Social + hobby.SocialChange)
	st.Mood = clampLife(st.Mood + hobby.MoodChange)
	addLifeSkills(&st.Skills, hobby.SkillGain)
	if hobby.SocialChange > 0 {
		st.Network.Friends += max(0, hobby.SocialChange/4)
		st.Network.ProfessionalContacts += max(0, hobby.SocialChange/5)
	}
	if hobby.ID == "volunteering" { st.Reputation = clampLife(st.Reputation + 2) }
	st.Lifestyle.HabitStreak++
	lifeHistory(st, now, "life", hobby.Title, "Время вне работы тоже влияет на долгую дистанцию.")
}

func hasLifeCredential(st *LifeState, id string) bool {
	for _, value := range st.Lifestyle.Credentials {
		if value == id { return true }
	}
	return false
}

func (s *Service) lifeCertificationStart(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	option, ok := findLifeCertification(id)
	if !ok { return ErrInput }
	if hasLifeCredential(st, id) { return ErrLifeLocked }
	if st.Education < option.MinEducation || !meetsLifeSkills(st.Skills, option.MinSkills) { return ErrLifeLocked }
	if st.Cash < option.Cost { return ErrLifeFunds }
	if st.Energy < 20 || st.Hunger < 15 { return ErrLifeNeeds }
	if err := checkLifeProjectSlot(st, "certification", id); err != nil { return err }
	st.Cash -= option.Cost
	return startLifeProject(st, now, time.Duration(option.DurationSeconds)*time.Second, LifeActivity{
		Kind:"certification", Target:id, Title:"Квалификация: "+option.Title, GameDays:option.GameDays, HungerCost:6, EnergyCost:12,
	})
}

func (s *Service) finishLifeCertification(st *LifeState, a LifeActivity, now time.Time) {
	option, ok := findLifeCertification(a.Target)
	if !ok || hasLifeCredential(st, option.ID) { return }
	st.Lifestyle.Credentials = append(st.Lifestyle.Credentials, option.ID)
	st.Lifestyle.Knowledge = clampLife(st.Lifestyle.Knowledge + 5)
	addLifeSkills(&st.Skills, option.SkillGain)
	st.Reputation = clampLife(st.Reputation + 1)
	lifeHistory(st, now, "study", "Получена квалификация", option.Title)
}

func (s *Service) lifeSocialStart(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	option, ok := findLifeSocial(id)
	if !ok { return ErrInput }
	if st.Cash < option.Cost { return ErrLifeFunds }
	if st.Energy < 10 || st.Hunger < 10 { return ErrLifeNeeds }
	if id == "date" && st.Lifestyle.Social < 20 { return ErrLifeLocked }
	if id == "weekend_together" && (st.Lifestyle.Social < 20 || st.Network.Relationship < 15) { return ErrLifeLocked }
	st.Cash -= option.Cost
	return startLifeActivity(st, now, time.Duration(option.DurationSeconds)*time.Second, LifeActivity{
		Kind:"social", Target:id, Title:option.Title, GameDays:option.GameDays, HungerCost:4, EnergyCost:5,
	})
}

func (s *Service) finishLifeSocial(st *LifeState, a LifeActivity, now time.Time) {
	option, ok := findLifeSocial(a.Target)
	if !ok { return }
	st.Network.Friends += option.Friends
	st.Network.ProfessionalContacts += option.Contacts
	st.Network.FamilyBond = clampLife(st.Network.FamilyBond + option.Family)
	st.Network.Relationship = clampLife(st.Network.Relationship + option.Relationship)
	st.Lifestyle.Social = clampLife(st.Lifestyle.Social + option.Friends*2 + option.Contacts + option.Relationship/2)
	st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + option.StressChange)
	st.Mood = clampLife(st.Mood + option.MoodChange)
	if option.ID == "mentor_search" && random(100) < min(80, 25+st.Network.ProfessionalContacts*2+st.Reputation) {
		st.Network.Mentors++
		st.Skills.Management = clampLife(st.Skills.Management + 2)
		st.Skills.Communication = clampLife(st.Skills.Communication + 2)
		lifeHistory(st, now, "social", "Наставник найден", "Профессиональная сеть начала приносить долгосрочную пользу.")
		return
	}
	lifeHistory(st, now, "social", option.Title, "Социальные отношения требуют времени, но защищают жизнь от превращения в один бесконечный рабочий цикл.")
}

func parseLifeMoneyTarget(target string) (string, int64, error) {
	parts := strings.Split(target, ":")
	if len(parts) != 2 { return "", 0, ErrInput }
	amount, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || amount <= 0 { return "", 0, ErrInput }
	return parts[0], amount, nil
}

func (s *Service) lifeFinanceSave(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	amount, err := strconv.ParseInt(target, 10, 64)
	if err != nil || amount < 100 { return ErrInput }
	if st.Cash < amount { return ErrLifeFunds }
	st.Cash -= amount
	st.Finance.Savings += amount
	st.Finance.CreditScore = min(850, st.Finance.CreditScore+1)
	lifeHistory(st, now, "finance", "Деньги отложены", fmt.Sprintf("%d ₽ отправлено в резерв.", amount))
	return nil
}

func (s *Service) lifeFinanceWithdraw(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	amount, err := strconv.ParseInt(target, 10, 64)
	if err != nil || amount < 100 { return ErrInput }
	if st.Finance.Savings < amount { return ErrLifeFunds }
	st.Finance.Savings -= amount
	st.Cash += amount
	lifeHistory(st, now, "finance", "Резерв использован", fmt.Sprintf("%d ₽ возвращено в наличные.", amount))
	return nil
}

func (s *Service) lifeFinanceInvest(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	id, amount, err := parseLifeMoneyTarget(target)
	if err != nil { return err }
	option, ok := findLifeInvestment(id)
	if !ok { return ErrInput }
	if st.Skills.Finance < option.MinFinance { return ErrLifeLocked }
	if amount < option.MinAmount { return ErrInput }
	if st.Cash < amount { return ErrLifeFunds }
	st.Cash -= amount
	st.Finance.Portfolio[id] += amount
	st.Finance.TotalInvested += amount
	lifeHistory(st, now, "finance", "Инвестиция", fmt.Sprintf("%d ₽ · %s.", amount, option.Title))
	return nil
}

func (s *Service) lifeFinanceSell(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	amount := st.Finance.Portfolio[id]
	if amount <= 0 { return ErrLifeLocked }
	if _, ok := findLifeInvestment(id); !ok { return ErrInput }
	delete(st.Finance.Portfolio, id)
	st.Cash += amount
	lifeHistory(st, now, "finance", "Позиция закрыта", fmt.Sprintf("%d ₽ возвращено в личные деньги.", amount))
	return nil
}

func (s *Service) lifeFinanceLoan(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	amount, err := strconv.ParseInt(target, 10, 64)
	if err != nil || amount < 5000 { return ErrInput }
	limit := int64(max(20_000, (st.Finance.CreditScore-500)*3000+st.Experience*1500))
	if st.Debt+amount > limit || st.Finance.CreditScore < 520 { return ErrLifeLocked }
	st.Cash += amount
	st.Debt += amount
	st.Finance.CreditScore = max(300, st.Finance.CreditScore-8)
	lifeHistory(st, now, "finance", "Получен личный кредит", fmt.Sprintf("%d ₽ · лимит зависит от кредитного рейтинга и опыта.", amount))
	return nil
}

func (s *Service) lifeInsuranceBuy(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	level, err := strconv.Atoi(target)
	if err != nil || level < 1 || level > 3 || level <= st.Finance.Insurance { return ErrInput }
	cost := []int64{0, 12000, 55000, 180000}[level]
	if st.Cash < cost { return ErrLifeFunds }
	st.Cash -= cost
	st.Finance.Insurance = level
	lifeHistory(st, now, "finance", "Страхование", fmt.Sprintf("Уровень защиты повышен до %d.", level))
	return nil
}

func advanceLifeExpansion(st *LifeState, days int, now time.Time) {
	if days <= 0 { return }
	normalizeLifeExpansion(st)

	expenseDays := min(days, 120)
	months := expenseDays / 30
	if months > 0 {
		baseCost := int64(4_000 + st.Home*8_000)
		transportCost := int64(0)
		if ownedLifeAsset(st, "used_car") { transportCost = 8_000 }
		if ownedLifeAsset(st, "reliable_car") { transportCost = 18_000 }
		if ownedLifeAsset(st, "premium_car") { transportCost = 65_000 }
		insuranceCost := int64(st.Finance.Insurance) * 1200
		living := int64(months) * (baseCost + transportCost + insuranceCost)
		changeLifeMoney(&st.Cash, &st.Debt, -living)

		if st.Debt > 0 {
			interest := st.Debt * int64(months) / 100
			st.Debt += interest
			st.Finance.CreditScore = max(300, st.Finance.CreditScore-months*2)
		}
		if st.Finance.Savings > 0 {
			interest := st.Finance.Savings * 4 * int64(days) / (100 * 365)
			st.Finance.Savings += interest
			st.Finance.LastReturn += interest
		}
	}

	var portfolioReturn int64
	for id, amount := range st.Finance.Portfolio {
		option, ok := findLifeInvestment(id)
		if !ok || amount <= 0 { continue }
		base := amount * int64(option.ReturnBPS) * int64(days) / (10_000 * 365)
		if lifeStoryChoice(st, "first_million") == "capital" {
			base = base * 105 / 100
		}
		switch st.Economy.Phase {
		case "boom":
			base = base * 140 / 100
		case "growth":
			base = base * 115 / 100
		case "slowdown":
			base = base * 75 / 100
		case "recession":
			base = -max(int64(1), base)
		}
		shock := int64(0)
		if days >= 7 && option.Risk > 1 {
			band := option.Risk * 70
			shockBPS := random(band*2+1) - band
			shock = amount * int64(shockBPS) / 10_000
		}
		next := max(int64(0), amount+base+shock)
		portfolioReturn += next - amount
		st.Finance.Portfolio[id] = next
	}
	st.Finance.LastReturn = portfolioReturn

	monthsPassed := days / 30
	if monthsPassed > 0 {
		st.Network.FamilyBond = clampLife(st.Network.FamilyBond - monthsPassed*2)
		if st.Network.Relationship > 0 {
			st.Network.Relationship = clampLife(st.Network.Relationship - monthsPassed*3)
		}
		st.Lifestyle.Social = clampLife(st.Lifestyle.Social - monthsPassed)
		st.Lifestyle.Fitness = clampLife(st.Lifestyle.Fitness - monthsPassed)
		if st.Network.Relationship >= 55 {
			st.Mood = clampLife(st.Mood + monthsPassed)
			st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - monthsPassed)
		}
		if st.Network.FamilyBond <= 15 {
			st.Mood = clampLife(st.Mood - monthsPassed)
		}
		if st.Lifestyle.Fitness <= 15 {
			st.Health = clampLife(st.Health - monthsPassed)
		}
	}
	st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - min(10, days/3))
	if st.Lifestyle.Stress >= 88 {
		st.Health = clampLife(st.Health - max(1, days/12))
		st.Mood = clampLife(st.Mood - max(1, days/10))
	}

	if st.Days-st.Economy.LastDay >= 90 {
		phases := []string{"normal","growth","boom","slowdown","recession"}
		weights := []int{38,24,10,18,10}
		roll := random(100)
		sum := 0
		for i, weight := range weights {
			sum += weight
			if roll < sum { st.Economy.Phase = phases[i]; break }
		}
		st.Economy.MarketIndex = max(65, min(145, st.Economy.MarketIndex+random(17)-8))
		st.Economy.Inflation = max(1, min(14, st.Economy.Inflation+random(5)-2))
		st.Economy.LastDay = st.Days
		lifeHistory(st, now, "world", "Экономика изменилась", fmt.Sprintf("Фаза: %s · индекс %d · инфляция %d%%.", st.Economy.Phase, st.Economy.MarketIndex, st.Economy.Inflation))
	}
}

func lifeEconomyBusinessFactor(st *LifeState) int {
	switch st.Economy.Phase {
	case "boom": return 116
	case "growth": return 108
	case "slowdown": return 94
	case "recession": return 82
	default: return 100
	}
}

func lifeCompanyExtraRevenue(st *LifeState) int64 {
	if st.Company == nil { return 0 }
	var total int64
	for _, product := range st.Company.Products {
		total += product.Revenue
	}
	for _, region := range st.Company.Regions {
		if region != "home" { total += int64(st.Company.Tier) * 250_000 }
	}
	if lifeStoryChoice(st, "international_model") == "local" {
		total = total * 106 / 100
	}
	return total
}

func lifeCompanyRiskReduction(st *LifeState) int {
	if st.Company == nil { return 0 }
	reduction := st.Company.Departments["operations"] + st.Company.Departments["finance"] + st.Company.Departments["legal"]
	reduction += max(0, lifeLevel(st)-60) / 10
	if lifeStoryChoice(st, "team_culture") == "people" { reduction++ }
	if lifeStoryChoice(st, "national_scale") == "system" { reduction += 2 }
	return reduction
}

func (s *Service) lifeBusinessSetIndustry(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || st.Company.Tier > 2 { return ErrLifeLocked }
	industry, ok := findLifeIndustry(id)
	if !ok { return ErrInput }
	if st.Company.Industry == id { return ErrLifeLocked }
	if st.Company.Cash < industry.EntryCost { return ErrLifeFunds }
	st.Company.Cash -= industry.EntryCost
	st.Company.Industry = id
	st.Company.Innovation = clampLife(max(st.Company.Innovation, 3+industry.TechWeight))
	st.Company.Brand = clampLife(max(0, st.Company.Brand-1))
	lifeHistory(st, now, "business", "Выбрана отрасль", industry.Title)
	return nil
}

func (s *Service) lifeBusinessDepartment(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil { return ErrLifeLocked }
	department, ok := findLifeDepartment(id)
	if !ok { return ErrInput }
	level := st.Company.Departments[id]
	if level >= 10 { return ErrLifeLocked }
	cost := department.BaseCost * int64(level+1) * int64(level+1) * int64(max(1, st.Company.Tier))
	if st.Company.Cash < cost { return ErrLifeFunds }
	st.Company.Cash -= cost
	st.Company.Departments[id] = level+1
	if id == "technology" || id == "product" {
		st.Company.Innovation = clampLife(st.Company.Innovation + 2 + level)
	}
	if id == "marketing" {
		st.Company.Brand = clampLife(st.Company.Brand + 1 + level/2)
	}
	lifeHistory(st, now, "business", "Отдел усилен", fmt.Sprintf("%s · уровень %d.", department.Title, level+1))
	return nil
}

func (s *Service) lifeBusinessLaunchProduct(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil { return ErrLifeLocked }
	product, ok := findLifeProduct(id)
	if !ok { return ErrInput }
	if st.Company.Tier < product.MinTier || st.Company.Innovation < product.InnovationNeed { return ErrLifeLocked }
	for _, existing := range st.Company.Products {
		if existing.ID == id && existing.Launches >= 5 { return ErrLifeLocked }
	}
	if st.Company.Cash < product.LaunchCost { return ErrLifeFunds }
	if err := checkLifeProjectSlot(st, "business_product", id); err != nil { return err }
	st.Company.Cash -= product.LaunchCost
	return startLifeProject(st, now, time.Duration(product.BuildSeconds)*time.Second, LifeActivity{
		Kind:"business_product", Target:id, Title:"Разработка: "+product.Title, GameDays:60, HungerCost:10, EnergyCost:20,
	})
}

func (s *Service) finishLifeBusinessProduct(st *LifeState, a LifeActivity, now time.Time) {
	if st.Company == nil { return }
	product, ok := findLifeProduct(a.Target)
	if !ok { return }
	productLevel := st.Company.Departments["product"]
	techLevel := st.Company.Departments["technology"]
	marketingLevel := st.Company.Departments["marketing"]
	quality := clampLife(38 + productLevel*5 + techLevel*3 + st.Company.Innovation/4 + random(18))
	fit := clampLife(30 + marketingLevel*4 + st.Company.Brand/3 + random(28))
	result := "средний"
	multiplier := int64(100)
	if quality+fit >= 145 { result = "сильный"; multiplier = 165 }
	if quality+fit >= 175 { result = "хит"; multiplier = 250 }
	if quality+fit < 85 { result = "провал"; multiplier = 25 }
	revenue := product.BaseRevenue * multiplier / 100
	updated := false
	for i := range st.Company.Products {
		if st.Company.Products[i].ID != product.ID { continue }
		previous := st.Company.Products[i]
		st.Company.Products[i].Quality = max(previous.Quality, quality)
		st.Company.Products[i].MarketFit = max(previous.MarketFit, fit)
		st.Company.Products[i].Revenue = max(previous.Revenue, revenue) + revenue/5
		st.Company.Products[i].Launches++
		st.Company.Products[i].LastResult = result
		updated = true
		break
	}
	if !updated {
		st.Company.Products = append(st.Company.Products, LifeCompanyProductState{
			ID:product.ID, Title:product.Title, Quality:quality, MarketFit:fit, Revenue:revenue, Launches:1, LastResult:result,
		})
	}
	st.Company.Brand = clampLife(st.Company.Brand + max(-2, (fit-50)/12))
	st.Company.Innovation = clampLife(st.Company.Innovation + 2)
	lifeHistory(st, now, "business", "Запуск продукта", fmt.Sprintf("%s: %s · потенциал выручки %d ₽.", product.Title, result, revenue))
}

func (s *Service) lifeBusinessRegion(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil { return ErrLifeLocked }
	region, ok := findLifeRegion(id)
	if !ok { return ErrInput }
	for _, existing := range st.Company.Regions { if existing == id { return ErrLifeLocked } }
	if st.Company.Tier < region.MinTier || st.Company.Brand < region.BrandNeed || st.Company.Departments["international"] < max(1, region.MinTier-3) {
		return ErrLifeLocked
	}
	if st.Company.Cash < region.Cost { return ErrLifeFunds }
	if err := checkLifeProjectSlot(st, "business_region", id); err != nil { return err }
	st.Company.Cash -= region.Cost
	return startLifeProject(st, now, time.Duration(max(600, region.MinTier*900))*time.Second, LifeActivity{
		Kind:"business_region", Target:id, Title:"Выход на рынок: "+region.Title, GameDays:90, HungerCost:8, EnergyCost:18,
	})
}

func (s *Service) finishLifeBusinessRegion(st *LifeState, a LifeActivity, now time.Time) {
	if st.Company == nil { return }
	region, ok := findLifeRegion(a.Target)
	if !ok { return }
	st.Company.Regions = append(st.Company.Regions, region.ID)
	st.Company.Brand = clampLife(st.Company.Brand + 4)
	st.Company.MarketShare = clampLife(st.Company.MarketShare + 2)
	st.Reputation = clampLife(st.Reputation + 3)
	lifeHistory(st, now, "business", "Новый рынок открыт", region.Title)
}

func (s *Service) lifeBusinessLoan(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || st.Company.Departments["finance"] < 1 { return ErrLifeLocked }
	amount, err := strconv.ParseInt(target, 10, 64)
	if err != nil || amount < 50_000 { return ErrInput }
	limit := max(int64(200_000), st.Company.Valuation/3)
	if st.Company.Debt+amount > limit { return ErrLifeLocked }
	st.Company.Cash += amount
	st.Company.Debt += amount
	lifeHistory(st, now, "business", "Компания привлекла долг", fmt.Sprintf("%d ₽.", amount))
	return nil
}

func (s *Service) lifeBusinessRepayLoan(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || st.Company.Debt <= 0 { return ErrLifeLocked }
	amount, err := strconv.ParseInt(target, 10, 64)
	if err != nil || amount <= 0 { return ErrInput }
	amount = min(amount, st.Company.Debt)
	if st.Company.Cash < amount { return ErrLifeFunds }
	st.Company.Cash -= amount
	st.Company.Debt -= amount
	lifeHistory(st, now, "business", "Корпоративный долг погашен", fmt.Sprintf("%d ₽.", amount))
	return nil
}

func (s *Service) lifeBusinessAcquire(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || st.Company.Tier < 5 || st.Company.Departments["finance"] < 3 || lifeLevel(st) < 82 { return ErrLifeLocked }
	if st.Company.Acquisitions >= 8 { return ErrLifeLocked }
	cost := max(int64(75_000_000), st.Company.Valuation/12) * int64(st.Company.Acquisitions+1)
	if st.Company.Cash < cost { return ErrLifeFunds }
	st.Company.Cash -= cost
	st.Company.Staff += max(25, st.Company.Staff/12)
	st.Company.Brand = clampLife(st.Company.Brand + 3)
	st.Company.Innovation = clampLife(st.Company.Innovation + 4)
	st.Company.MarketShare = clampLife(st.Company.MarketShare + 4)
	st.Company.Acquisitions++
	st.Company.Valuation += cost + cost/2
	lifeHistory(st, now, "business", "Поглощение завершено", fmt.Sprintf("На сделку потрачено %d ₽. Компания получила команду, технологии и долю рынка.", cost))
	return nil
}

func (s *Service) lifeBusinessIPO(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || st.Company.Public || st.Company.Tier < 6 || lifeLevel(st) < 90 { return ErrLifeLocked }
	if lifeStoryChoice(st, "ipo_question") == "private" && lifeLevel(st) < 96 { return ErrLifeLocked }
	if st.Company.Brand < 72 || st.Company.Departments["finance"] < 5 || st.Company.Departments["legal"] < 4 { return ErrLifeLocked }
	valuation := max(st.Company.Valuation, st.Company.Cash*5+lifeCompanyExtraRevenue(st)*8)
	raise := valuation / 4
	st.Company.Cash += raise
	st.Company.Public = true
	st.Company.Ownership = 70
	st.Company.Valuation = valuation + raise
	st.Reputation = clampLife(st.Reputation + 8)
	lifeHistory(st, now, "business", "Компания вышла на биржу", fmt.Sprintf("Привлечено %d ₽. Доля основателя теперь 70%%.", raise))
	return nil
}

func finishLifeExpansionActivity(s *Service, st *LifeState, a LifeActivity, now time.Time) bool {
	switch a.Kind {
	case "career_interview":
		s.finishLifeCareerInterview(st, a, now)
	case "career_month":
		s.finishLifeCareerMonth(st, a, now)
	case "hobby":
		s.finishLifeHobby(st, a, now)
	case "certification":
		s.finishLifeCertification(st, a, now)
	case "social":
		s.finishLifeSocial(st, a, now)
	case "business_product":
		s.finishLifeBusinessProduct(st, a, now)
	case "business_region":
		s.finishLifeBusinessRegion(st, a, now)
	default:
		return false
	}
	return true
}
