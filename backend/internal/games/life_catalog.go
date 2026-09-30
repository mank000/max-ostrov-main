package games

type LifeSkills struct {
	Discipline int `json:"discipline"`
	Communication int `json:"communication"`
	Digital int `json:"digital"`
	Finance int `json:"finance"`
	Management int `json:"management"`
}

type LifeJobOption struct {
	ID string `json:"id"`
	Title string `json:"title"`
	Description string `json:"description"`
	Pay int64 `json:"pay"`
	DurationSeconds int64 `json:"duration_seconds"`
	GameDays int `json:"game_days"`
	HungerCost int `json:"hunger_cost"`
	EnergyCost int `json:"energy_cost"`
	MinEducation int `json:"min_education"`
	MinExperience int `json:"min_experience"`
	MinReputation int `json:"min_reputation"`
	MinSkills LifeSkills `json:"min_skills"`
	SkillGain LifeSkills `json:"skill_gain"`
	ExperienceGain int `json:"experience_gain"`
}

type LifeProgramOption struct {
	ID string `json:"id"`
	Title string `json:"title"`
	Description string `json:"description"`
	Cost int64 `json:"cost"`
	DurationSeconds int64 `json:"duration_seconds"`
	GameDays int `json:"game_days"`
	Level int `json:"level"`
	MinEducation int `json:"min_education"`
	MinExperience int `json:"min_experience"`
	MinSkills LifeSkills `json:"min_skills"`
	SkillGain LifeSkills `json:"skill_gain"`
}

type LifeTrainingOption struct {
	ID string `json:"id"`
	Title string `json:"title"`
	Description string `json:"description"`
	Cost int64 `json:"cost"`
	DurationSeconds int64 `json:"duration_seconds"`
	GameDays int `json:"game_days"`
	EnergyCost int `json:"energy_cost"`
	SkillGain LifeSkills `json:"skill_gain"`
}

type LifeMealOption struct {
	ID string `json:"id"`
	Title string `json:"title"`
	Description string `json:"description"`
	Cost int64 `json:"cost"`
	HungerGain int `json:"hunger_gain"`
	HealthGain int `json:"health_gain"`
	MoodGain int `json:"mood_gain"`
	Emergency bool `json:"emergency,omitempty"`
}

type LifeHomeOption struct {
	Level int `json:"level"`
	Title string `json:"title"`
	Description string `json:"description"`
	Cost int64 `json:"cost"`
	RestBonus int `json:"rest_bonus"`
	MoodBonus int `json:"mood_bonus"`
}

type LifeBusinessTierOption struct {
	Level int `json:"level"`
	MinLevel int `json:"min_level"`
	Title string `json:"title"`
	Description string `json:"description"`
	UpgradeCost int64 `json:"upgrade_cost"`
	BaseRevenue int64 `json:"base_revenue"`
	MinStaff int `json:"min_staff"`
	MinBrand int `json:"min_brand"`
	MinManagement int `json:"min_management"`
	MinFinance int `json:"min_finance"`
	CycleSeconds int64 `json:"cycle_seconds"`
	UpgradeSeconds int64 `json:"upgrade_seconds"`
}

type LifeCatalog struct {
	Jobs []LifeJobOption `json:"jobs"`
	Programs []LifeProgramOption `json:"programs"`
	Training []LifeTrainingOption `json:"training"`
	Meals []LifeMealOption `json:"meals"`
	Homes []LifeHomeOption `json:"homes"`
	BusinessTiers []LifeBusinessTierOption `json:"business_tiers"`
	Expansion LifeExpansionCatalog `json:"expansion"`
}

var lifeJobs = []LifeJobOption{
	{ID:"flyers", Title:"Промоутер", Description:"Первая подработка без требований.", Pay:750, DurationSeconds:45, GameDays:1, HungerCost:7, EnergyCost:13, SkillGain:LifeSkills{Discipline:1}, ExperienceGain:1},
	{ID:"warehouse", Title:"Складская смена", Description:"Тяжелее, но платят больше.", Pay:1200, DurationSeconds:65, GameDays:1, HungerCost:10, EnergyCost:19, MinExperience:2, SkillGain:LifeSkills{Discipline:1}, ExperienceGain:1},
	{ID:"courier", Title:"Курьер", Description:"Стабильная городская подработка.", Pay:1650, DurationSeconds:80, GameDays:1, HungerCost:9, EnergyCost:17, MinExperience:4, MinSkills:LifeSkills{Discipline:11}, SkillGain:LifeSkills{Discipline:1,Communication:1}, ExperienceGain:1},
	{ID:"barista", Title:"Бариста", Description:"Работа с людьми и быстрым ритмом.", Pay:2100, DurationSeconds:95, GameDays:1, HungerCost:8, EnergyCost:15, MinExperience:7, MinSkills:LifeSkills{Communication:12}, SkillGain:LifeSkills{Communication:2}, ExperienceGain:1},
	{ID:"support", Title:"Оператор поддержки", Description:"Первый офисный опыт.", Pay:3100, DurationSeconds:120, GameDays:1, HungerCost:7, EnergyCost:14, MinExperience:10, MinSkills:LifeSkills{Communication:16,Digital:12}, SkillGain:LifeSkills{Communication:1,Digital:1}, ExperienceGain:2},
	{ID:"freelance", Title:"Фриланс-заказ", Description:"Небольшой цифровой проект. Альтернативный путь без формальной должности.", Pay:4300, DurationSeconds:155, GameDays:2, HungerCost:8, EnergyCost:17, MinExperience:10, MinSkills:LifeSkills{Digital:24,Discipline:16}, SkillGain:LifeSkills{Digital:2,Discipline:1}, ExperienceGain:2},
	{ID:"tutor", Title:"Частный репетитор", Description:"Монетизируйте знания и коммуникацию после первой ступени образования.", Pay:3600, DurationSeconds:135, GameDays:1, HungerCost:7, EnergyCost:14, MinEducation:1, MinExperience:10, MinSkills:LifeSkills{Communication:18,Discipline:16}, SkillGain:LifeSkills{Communication:2,Discipline:1}, ExperienceGain:2},
	{ID:"assistant", Title:"Ассистент отдела", Description:"Документы, таблицы и команда.", Pay:4700, DurationSeconds:165, GameDays:1, HungerCost:7, EnergyCost:15, MinEducation:1, MinExperience:14, MinSkills:LifeSkills{Digital:18,Discipline:18}, SkillGain:LifeSkills{Digital:1,Discipline:1}, ExperienceGain:2},
	{ID:"junior_analyst", Title:"Младший аналитик", Description:"Метрики и первые бизнес-решения.", Pay:7200, DurationSeconds:220, GameDays:1, HungerCost:7, EnergyCost:16, MinEducation:1, MinExperience:20, MinSkills:LifeSkills{Digital:26,Finance:16}, SkillGain:LifeSkills{Digital:2,Finance:1}, ExperienceGain:3},
	{ID:"specialist", Title:"Ведущий специалист", Description:"Самостоятельные проекты.", Pay:11000, DurationSeconds:280, GameDays:1, HungerCost:7, EnergyCost:17, MinEducation:2, MinExperience:28, MinReputation:6, MinSkills:LifeSkills{Digital:34,Communication:24}, SkillGain:LifeSkills{Digital:1,Communication:1,Discipline:1}, ExperienceGain:3},
	{ID:"senior", Title:"Старший специалист", Description:"Сложные задачи и наставничество.", Pay:18000, DurationSeconds:360, GameDays:1, HungerCost:8, EnergyCost:18, MinEducation:2, MinExperience:40, MinReputation:12, MinSkills:LifeSkills{Digital:42,Communication:30,Discipline:32}, SkillGain:LifeSkills{Communication:1,Management:1}, ExperienceGain:4},
	{ID:"consulting", Title:"Частный консультант", Description:"Высокооплачиваемые проекты без постоянной должности. Требуют репутации и сильных финансовых навыков.", Pay:26000, DurationSeconds:420, GameDays:2, HungerCost:9, EnergyCost:20, MinEducation:2, MinExperience:45, MinReputation:20, MinSkills:LifeSkills{Communication:38,Finance:38,Discipline:34}, SkillGain:LifeSkills{Finance:2,Communication:1,Management:1}, ExperienceGain:5},
	{ID:"manager", Title:"Руководитель команды", Description:"Люди, сроки и бюджет.", Pay:30000, DurationSeconds:480, GameDays:2, HungerCost:10, EnergyCost:22, MinEducation:2, MinExperience:55, MinReputation:18, MinSkills:LifeSkills{Management:34,Communication:38,Finance:28}, SkillGain:LifeSkills{Management:2,Finance:1}, ExperienceGain:5},
	{ID:"head", Title:"Директор направления", Description:"Стратегия и крупные бюджеты.", Pay:52000, DurationSeconds:600, GameDays:2, HungerCost:10, EnergyCost:23, MinEducation:3, MinExperience:75, MinReputation:28, MinSkills:LifeSkills{Management:50,Communication:48,Finance:42}, SkillGain:LifeSkills{Management:2,Finance:1,Communication:1}, ExperienceGain:6},
	{ID:"executive", Title:"Топ-менеджер", Description:"Уровень крупной корпорации.", Pay:155000, DurationSeconds:900, GameDays:4, HungerCost:12, EnergyCost:27, MinEducation:4, MinExperience:130, MinReputation:55, MinSkills:LifeSkills{Management:78,Finance:72,Communication:68,Discipline:60}, SkillGain:LifeSkills{Management:2,Finance:2,Communication:1}, ExperienceGain:10},
	{ID:"board_advisor", Title:"Советник совета директоров", Description:"Редкие стратегические сессии для крупного бизнеса. Платят за репутацию и накопленный опыт.", Pay:120000, DurationSeconds:780, GameDays:3, HungerCost:10, EnergyCost:24, MinEducation:4, MinExperience:120, MinReputation:60, MinSkills:LifeSkills{Management:75,Finance:75,Communication:65}, SkillGain:LifeSkills{Management:2,Finance:2,Communication:1}, ExperienceGain:8},
}

var lifePrograms = []LifeProgramOption{
	{ID:"college", Title:"Колледж: коммерция и сервис", Description:"Два игровых года. Открывает офисные позиции.", Cost:8000, DurationSeconds:7200, GameDays:730, Level:1, SkillGain:LifeSkills{Discipline:8,Communication:6,Digital:7,Finance:5}},
	{ID:"bachelor", Title:"Бакалавриат: бизнес-информатика", Description:"Четыре игровых года и сильная цифровая база.", Cost:65000, DurationSeconds:36000, GameDays:1460, Level:2, MinEducation:1, MinSkills:LifeSkills{Digital:18,Discipline:18}, SkillGain:LifeSkills{Digital:14,Finance:10,Discipline:8,Communication:5}},
	{ID:"master", Title:"Магистратура: управление", Description:"Два игровых года для руководящей карьеры.", Cost:220000, DurationSeconds:28800, GameDays:730, Level:3, MinEducation:2, MinExperience:30, MinSkills:LifeSkills{Management:22,Finance:20}, SkillGain:LifeSkills{Management:15,Finance:10,Communication:8}},
	{ID:"mba", Title:"Executive MBA", Description:"Финальная образовательная ступень.", Cost:1200000, DurationSeconds:57600, GameDays:365, Level:4, MinEducation:3, MinExperience:80, MinSkills:LifeSkills{Management:48,Finance:45,Communication:42}, SkillGain:LifeSkills{Management:18,Finance:15,Communication:10,Discipline:6}},
}

var lifeTraining = []LifeTrainingOption{
	{ID:"discipline", Title:"Планирование недели", Description:"Бесплатная практика привычек.", DurationSeconds:180, GameDays:7, EnergyCost:8, SkillGain:LifeSkills{Discipline:4}},
	{ID:"communication", Title:"Практика публичной речи", Description:"Переговоры и выступления.", Cost:4000, DurationSeconds:240, GameDays:10, EnergyCost:9, SkillGain:LifeSkills{Communication:5}},
	{ID:"digital", Title:"Курс по данным", Description:"Аналитика и цифровые инструменты.", Cost:6500, DurationSeconds:300, GameDays:14, EnergyCost:10, SkillGain:LifeSkills{Digital:5}},
	{ID:"finance", Title:"Финансовая грамотность", Description:"Бюджет и экономика проекта.", Cost:8000, DurationSeconds:330, GameDays:14, EnergyCost:10, SkillGain:LifeSkills{Finance:5}},
	{ID:"management", Title:"Управление командой", Description:"Люди, найм и ответственность.", Cost:12000, DurationSeconds:360, GameDays:18, EnergyCost:11, SkillGain:LifeSkills{Management:5,Communication:1}},
}

var lifeMeals = []LifeMealOption{
	{ID:"help", Title:"Бесплатная столовая", Description:"Аварийный вариант, если совсем нет денег.", HungerGain:30, MoodGain:1, Emergency:true},
	{ID:"snack", Title:"Перекус", Description:"Быстро и недорого.", Cost:180, HungerGain:18},
	{ID:"meal", Title:"Обычный обед", Description:"Нормальная еда без лишних расходов.", Cost:480, HungerGain:38, HealthGain:1, MoodGain:1},
	{ID:"good_meal", Title:"Хороший ужин", Description:"Восстанавливает силы и настроение.", Cost:950, HungerGain:58, HealthGain:2, MoodGain:4},
}

var lifeHomes = []LifeHomeOption{
	{Level:0, Title:"Временная комната", Description:"Есть где спать, но комфорта почти нет."},
	{Level:1, Title:"Комната в общежитии", Description:"Своя зона и стабильный быт.", Cost:20000, RestBonus:6, MoodBonus:2},
	{Level:2, Title:"Небольшая студия", Description:"Первое собственное жильё.", Cost:400000, RestBonus:11, MoodBonus:4},
	{Level:3, Title:"Квартира", Description:"Комфортный городской уровень.", Cost:2200000, RestBonus:16, MoodBonus:6},
	{Level:4, Title:"Загородный дом", Description:"Пространство и хорошее восстановление.", Cost:15000000, RestBonus:21, MoodBonus:8},
	{Level:5, Title:"Пентхаус", Description:"Жильё владельца большого бизнеса.", Cost:150000000, RestBonus:26, MoodBonus:10},
}

var lifeBusinessTiers = []LifeBusinessTierOption{
	{Level:1, MinLevel:55, Title:"Маленькая студия", Description:"Вы и несколько подрядчиков.", UpgradeCost:50000, BaseRevenue:35000, MinManagement:15, MinFinance:10, CycleSeconds:600, UpgradeSeconds:1200},
	{Level:2, MinLevel:62, Title:"Микрокомпания", Description:"Команда и повторяемые продажи.", UpgradeCost:300000, BaseRevenue:280000, MinStaff:4, MinBrand:8, MinManagement:24, MinFinance:20, CycleSeconds:1200, UpgradeSeconds:3600},
	{Level:3, MinLevel:68, Title:"Региональная компания", Description:"Несколько команд и руководители.", UpgradeCost:2000000, BaseRevenue:2200000, MinStaff:22, MinBrand:18, MinManagement:36, MinFinance:32, CycleSeconds:2700, UpgradeSeconds:10800},
	{Level:4, MinLevel:75, Title:"Национальная компания", Description:"Офисы в разных городах.", UpgradeCost:20000000, BaseRevenue:24000000, MinStaff:140, MinBrand:32, MinManagement:50, MinFinance:45, CycleSeconds:4500, UpgradeSeconds:28800},
	{Level:5, MinLevel:82, Title:"Группа компаний", Description:"Несколько бизнес-направлений.", UpgradeCost:200000000, BaseRevenue:240000000, MinStaff:900, MinBrand:48, MinManagement:62, MinFinance:58, CycleSeconds:7200, UpgradeSeconds:64800},
	{Level:6, MinLevel:90, Title:"Международный холдинг", Description:"Бизнес в нескольких странах.", UpgradeCost:1500000000, BaseRevenue:1900000000, MinStaff:6000, MinBrand:66, MinManagement:74, MinFinance:70, CycleSeconds:14400, UpgradeSeconds:129600},
	{Level:7, MinLevel:97, Title:"Транснациональная корпорация", Description:"Глобальная компания. Вершина не заканчивает игру.", UpgradeCost:10000000000, BaseRevenue:15000000000, MinStaff:30000, MinBrand:82, MinManagement:88, MinFinance:86, CycleSeconds:28800, UpgradeSeconds:259200},
}

func lifeCatalog() LifeCatalog {
	return LifeCatalog{
		Jobs:lifeJobs,
		Programs:lifePrograms,
		Training:lifeTraining,
		Meals:lifeMeals,
		Homes:lifeHomes,
		BusinessTiers:lifeBusinessTiers,
		Expansion:lifeExpansionCatalog(),
	}
}

func findLifeJob(id string) (LifeJobOption, bool) { for _, v := range lifeJobs { if v.ID == id { return v, true } }; return LifeJobOption{}, false }
func findLifeProgram(id string) (LifeProgramOption, bool) { for _, v := range lifePrograms { if v.ID == id { return v, true } }; return LifeProgramOption{}, false }
func findLifeTraining(id string) (LifeTrainingOption, bool) { for _, v := range lifeTraining { if v.ID == id { return v, true } }; return LifeTrainingOption{}, false }
func findLifeMeal(id string) (LifeMealOption, bool) { for _, v := range lifeMeals { if v.ID == id { return v, true } }; return LifeMealOption{}, false }
func findLifeBusinessTier(level int) (LifeBusinessTierOption, bool) { for _, v := range lifeBusinessTiers { if v.Level == level { return v, true } }; return LifeBusinessTierOption{}, false }
