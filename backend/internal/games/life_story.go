package games

import (
	"fmt"
	"time"
)

type LifeStoryState struct {
	Completed   []string          `json:"completed"`
	Choices     map[string]string `json:"choices"`
	Patterns    map[string]int    `json:"patterns,omitempty"`
	LastBeatDay int               `json:"last_beat_day,omitempty"`
}

type LifeStoryBeatView struct {
	ID          string `json:"id"`
	Era         int    `json:"era"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type LifeStoryView struct {
	Completed int                `json:"completed"`
	Total     int                `json:"total"`
	LastBeat  *LifeStoryBeatView `json:"last_beat,omitempty"`
	NextBeat  *LifeStoryBeatView `json:"next_beat,omitempty"`
	Choices   map[string]string  `json:"choices"`
}

type lifeStoryChoiceDef struct {
	ID    string
	Title string
	Hint  string
	Apply func(*LifeState)
}

type lifeStoryNodeDef struct {
	ID          string
	Era         int
	Title       string
	Text        string
	Description string
	Severity    string
	Optional    bool
	Condition   func(*LifeState) bool
	Choices     []lifeStoryChoiceDef
}

func storyCompany(st *LifeState) *LifeCompanyState {
	return st.Company
}

func storyTransferToSavings(st *LifeState, amount int64) {
	if amount <= 0 { return }
	amount = min(amount, st.Cash)
	if amount <= 0 { return }
	st.Cash -= amount
	st.Finance.Savings += amount
}

func storyCompanySpend(st *LifeState, amount int64) bool {
	if st.Company == nil || amount <= 0 || st.Company.Cash < amount { return false }
	st.Company.Cash -= amount
	return true
}

func storyDepartment(st *LifeState, id string, gain int) {
	if st.Company == nil || gain == 0 { return }
	if st.Company.Departments == nil { st.Company.Departments = map[string]int{} }
	st.Company.Departments[id] = max(0, min(10, st.Company.Departments[id]+gain))
}

var lifeStoryNodes = []lifeStoryNodeDef{
	{
		ID:"first_payday", Era:1, Title:"Первые деньги",
		Text:"Впервые за всё прохождение у вас появились собственные заработанные деньги. Сумма маленькая, но именно сейчас формируется отношение к ней.",
		Description:"Первый заработок определяет ранний стиль выживания.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.TotalEarned >= 1_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"recover", Title:"Сначала привести себя в порядок", Hint:"Нормально поесть и снять часть напряжения.", Apply:func(st *LifeState) {
				cost := min(int64(500), st.Cash)
				st.Cash -= cost
				st.Hunger = clampLife(st.Hunger + 24)
				st.Mood = clampLife(st.Mood + 5)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 4)
			}},
			{ID:"save", Title:"Сохранить почти всё", Hint:"Тяжелее сейчас, но вы начинаете мыслить резервом.", Apply:func(st *LifeState) {
				st.Skills.Finance = clampLife(st.Skills.Finance + 2)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 2)
			}},
		},
	},
	{
		ID:"first_home", Era:1, Title:"Первое устойчивое жильё",
		Text:"Впервые появилось место, которое можно назвать своей базой. Даже очень скромное жильё меняет ощущение жизни.",
		Description:"Первый переход от временного выживания к устойчивому быту.", Severity:"good",
		Condition:func(st *LifeState) bool { return max(st.Home, st.MaxHome) >= 1 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"settle", Title:"Сделать это местом для жизни", Hint:"Немного больше комфорта и настроения.", Apply:func(st *LifeState) {
				st.Lifestyle.Comfort = clampLife(st.Lifestyle.Comfort + 6)
				st.Mood = clampLife(st.Mood + 5)
			}},
			{ID:"minimal", Title:"Пока жить максимально просто", Hint:"Фокус остаётся на накоплениях и дисциплине.", Apply:func(st *LifeState) {
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 2)
				st.Skills.Finance = clampLife(st.Skills.Finance + 1)
			}},
		},
	},
	{
		ID:"education_plan", Era:2, Title:"Пора решать, что делать с образованием",
		Text:"Подработки позволяют выживать, но всё заметнее потолок: без системного обучения большинство сильных карьерных траекторий останутся закрыты.",
		Description:"Первая серьёзная развилка между быстрыми деньгами и длинным развитием.", Severity:"warning",
		Condition:func(st *LifeState) bool { return lifeLevel(st) >= 10 && st.Education == 0 && st.Cash >= 8_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"study_first", Title:"Сделать образование приоритетом", Hint:"Больше дисциплины и знаний; путь к профессии станет естественнее.", Apply:func(st *LifeState) {
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 3)
				st.Lifestyle.Knowledge = clampLife(st.Lifestyle.Knowledge + 5)
				st.Mood = clampLife(st.Mood + 2)
			}},
			{ID:"work_first", Title:"Сначала укрепить финансовую базу", Hint:"Лучше финансовая дисциплина, но академический рывок откладывается.", Apply:func(st *LifeState) {
				st.Skills.Finance = clampLife(st.Skills.Finance + 3)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 1)
			}},
		},
	},
	{
		ID:"first_credential", Era:2, Title:"Первый прикладной навык",
		Text:"У вас появился первый навык, который можно показать работодателю не только словами. Теперь можно выбрать, каким специалистом становиться дальше.",
		Description:"Первое профессиональное самоопределение.", Severity:"good",
		Condition:func(st *LifeState) bool { return len(st.Lifestyle.Credentials) >= 1 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"specialize", Title:"Углубляться в сильную сторону", Hint:"Digital и дисциплина растут быстрее.", Apply:func(st *LifeState) {
				st.Skills.Digital = clampLife(st.Skills.Digital + 2)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 1)
			}},
			{ID:"broad", Title:"Оставаться универсалом", Hint:"Коммуникация и финансы растут равномернее.", Apply:func(st *LifeState) {
				st.Skills.Communication = clampLife(st.Skills.Communication + 2)
				st.Skills.Finance = clampLife(st.Skills.Finance + 1)
			}},
		},
	},
	{
		ID:"first_career", Era:3, Title:"Первая настоящая работа",
		Text:"Теперь это уже не случайная смена. Есть работодатель, должность, зарплата, ожидания и риск всё потерять. Отношение к работе начинает формировать карьеру.",
		Description:"Начало постоянной карьеры.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.Career != nil },
		Choices:[]lifeStoryChoiceDef{
			{ID:"ambition", Title:"Выжать максимум из первых лет", Hint:"Выше результативность и дисциплина, но больше стресс.", Apply:func(st *LifeState) {
				if st.Career != nil { st.Career.Performance = clampLife(st.Career.Performance + 7) }
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 2)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 6)
			}},
			{ID:"balance", Title:"Сразу строить устойчивый ритм", Hint:"Меньше карьерный рывок, зато здоровье и устойчивость выше.", Apply:func(st *LifeState) {
				if st.Career != nil { st.Career.Stability = clampLife(st.Career.Stability + 6) }
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 5)
				st.Health = clampLife(st.Health + 3)
			}},
		},
	},
	{
		ID:"first_100k", Era:3, Title:"Первые серьёзные деньги",
		Text:"Суммарный заработок впервые перестал выглядеть как набор случайных смен. Теперь деньги можно использовать не только для выживания.",
		Description:"Переход от дохода к личной финансовой системе.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.TotalEarned >= 100_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"reserve", Title:"Создать настоящий резерв", Hint:"Часть наличных автоматически уйдёт в подушку.", Apply:func(st *LifeState) {
				storyTransferToSavings(st, min(int64(25_000), st.Cash/3))
				st.Finance.CreditScore = min(850, st.Finance.CreditScore+8)
			}},
			{ID:"self_invest", Title:"Инвестировать в себя", Hint:"Не переводит деньги автоматически, но ускоряет личное развитие.", Apply:func(st *LifeState) {
				st.Lifestyle.Knowledge = clampLife(st.Lifestyle.Knowledge + 5)
				st.Skills.Communication = clampLife(st.Skills.Communication + 2)
				st.Skills.Digital = clampLife(st.Skills.Digital + 2)
			}},
		},
	},
	{
		ID:"first_million", Era:4, Title:"Первый миллион капитала",
		Text:"Это уже не просто хорошая зарплата. Впервые появляется настоящая свобода выбора: ускорять капитал или заметно улучшать качество жизни.",
		Description:"Первый крупный личный финансовый рубеж.", Severity:"good",
		Condition:func(st *LifeState) bool { return lifeNetWorth(*st) >= 1_000_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"capital", Title:"Капитал важнее статуса", Hint:"Усиливает финансовое мышление и дисциплину.", Apply:func(st *LifeState) {
				st.Skills.Finance = clampLife(st.Skills.Finance + 4)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 2)
			}},
			{ID:"comfort", Title:"Жизнь должна становиться лучше", Hint:"Больше комфорта и настроения, меньше накопленного стресса.", Apply:func(st *LifeState) {
				st.Lifestyle.Comfort = clampLife(st.Lifestyle.Comfort + 10)
				st.Mood = clampLife(st.Mood + 7)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 7)
			}},
		},
	},
	{
		ID:"career_identity", Era:4, Title:"Кем вы хотите стать в профессии?",
		Text:"Просто хорошо выполнять задачи уже недостаточно. Дальше путь начинает расходиться между глубокой экспертизой и ответственностью за других людей.",
		Description:"Выбор профессиональной идентичности.", Severity:"warning",
		Condition:func(st *LifeState) bool { return lifeLevel(st) >= 35 && st.Career != nil && st.Experience >= 30 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"expert", Title:"Стать редким сильным экспертом", Hint:"Digital и профессиональная дисциплина растут быстрее.", Apply:func(st *LifeState) {
				st.Skills.Digital = clampLife(st.Skills.Digital + 5)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 3)
			}},
			{ID:"manager", Title:"Учиться вести людей", Hint:"Управление и коммуникация получают сильный толчок.", Apply:func(st *LifeState) {
				st.Skills.Management = clampLife(st.Skills.Management + 5)
				st.Skills.Communication = clampLife(st.Skills.Communication + 3)
			}},
		},
	},
	{
		ID:"management_turn", Era:5, Title:"Ответственность стала больше самой работы",
		Text:"Теперь ценность создаётся не только вашими руками. Нужно решить, комфортно ли вам отвечать за людей, сроки и чужие ошибки.",
		Description:"Переход от специалиста к лидеру.", Severity:"warning",
		Condition:func(st *LifeState) bool { return lifeLevel(st) >= 45 && st.Skills.Management >= 35 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"lead", Title:"Принять управленческую роль", Hint:"Ускоряет управление, коммуникацию и профессиональную репутацию.", Apply:func(st *LifeState) {
				st.Skills.Management = clampLife(st.Skills.Management + 5)
				st.Skills.Communication = clampLife(st.Skills.Communication + 3)
				st.Reputation = clampLife(st.Reputation + 3)
			}},
			{ID:"craft", Title:"Сохранить техническую независимость", Hint:"Укрепляет expertise и снижает часть управленческого стресса.", Apply:func(st *LifeState) {
				st.Skills.Digital = clampLife(st.Skills.Digital + 4)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 2)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 4)
			}},
		},
	},
	{
		ID:"relationship_crossroad", Era:5, Optional:true, Title:"Работа больше не единственная часть жизни",
		Text:"Отношения стали достаточно серьёзными, чтобы их нельзя было поддерживать остаточным временем. Любой выбор теперь будет иметь цену.",
		Description:"Личная жизнь входит в конфликт с карьерным темпом.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Network.Relationship >= 25 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"commit", Title:"Осознанно выделять время отношениям", Hint:"Отношения и настроение укрепляются, стресс снижается.", Apply:func(st *LifeState) {
				st.Network.Relationship = clampLife(st.Network.Relationship + 12)
				st.Mood = clampLife(st.Mood + 5)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 5)
			}},
			{ID:"career", Title:"Сейчас приоритет — карьера", Hint:"Дисциплина растёт, но отношения получают удар.", Apply:func(st *LifeState) {
				st.Network.Relationship = clampLife(st.Network.Relationship - 10)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 2)
				st.Mood = clampLife(st.Mood - 2)
			}},
		},
	},
	{
		ID:"debt_warning", Era:5, Optional:true, Title:"Долг начинает управлять решениями",
		Text:"Обязательства стали достаточно большими, чтобы влиять на свободу выбора. Это ещё не катастрофа, но игнорировать долг уже нельзя.",
		Description:"Сюжетный кризис личных финансов.", Severity:"danger",
		Condition:func(st *LifeState) bool { return st.Debt >= 100_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"discipline", Title:"Заморозить лишние расходы", Hint:"Финансовый навык и кредитная дисциплина растут.", Apply:func(st *LifeState) {
				st.Skills.Finance = clampLife(st.Skills.Finance + 4)
				st.Finance.CreditScore = min(850, st.Finance.CreditScore+6)
				st.Mood = clampLife(st.Mood - 2)
			}},
			{ID:"pressure", Title:"Продолжать жить как раньше", Hint:"Настроение не страдает сразу, но кредитная позиция ухудшается.", Apply:func(st *LifeState) {
				st.Finance.CreditScore = max(300, st.Finance.CreditScore-20)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 8)
			}},
		},
	},
	{
		ID:"founder_question", Era:6, Title:"Оставаться хорошо оплачиваемым сотрудником?",
		Text:"У вас уже есть опыт, капитал и управленческие навыки. Впервые собственный бизнес становится не фантазией, а реальной альтернативой стабильной карьере.",
		Description:"Главный переход от карьеры к предпринимательству.", Severity:"warning",
		Condition:func(st *LifeState) bool { return lifeLevel(st) >= 55 && st.Company == nil && st.Cash >= 50_000 && st.Skills.Management >= 15 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"ready", Title:"Я готов однажды рискнуть стабильностью", Hint:"Управление и финансы получают небольшой предпринимательский бонус.", Apply:func(st *LifeState) {
				st.Skills.Management = clampLife(st.Skills.Management + 3)
				st.Skills.Finance = clampLife(st.Skills.Finance + 2)
			}},
			{ID:"career", Title:"Сначала стать ещё сильнее в найме", Hint:"Репутация и профессиональная устойчивость растут.", Apply:func(st *LifeState) {
				st.Reputation = clampLife(st.Reputation + 3)
				if st.Career != nil { st.Career.Stability = clampLife(st.Career.Stability + 5) }
			}},
		},
	},
	{
		ID:"company_birth", Era:7, Title:"Теперь ответственность полностью ваша",
		Text:"Компания существует. Денег мало, процессы держатся на вас, а первая ошибка может оказаться последней. Возникает вопрос: строить всё одному или разделить риск.",
		Description:"Формирование структуры владения первой компанией.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Tier >= 1 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"solo", Title:"Сохранить 100% и строить самому", Hint:"Контроль остаётся у вас, управление растёт через личную ответственность.", Apply:func(st *LifeState) {
				if st.Company != nil { st.Company.Ownership = 100 }
				st.Skills.Management = clampLife(st.Skills.Management + 3)
			}},
			{ID:"cofounder", Title:"Взять сильного сооснователя", Hint:"Компания получает капитал и бренд, но ваша доля снижается.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.Ownership = min(st.Company.Ownership, 80)
					st.Company.Cash += 100_000
					st.Company.Brand = clampLife(st.Company.Brand + 3)
				}
				st.Skills.Communication = clampLife(st.Skills.Communication + 2)
			}},
		},
	},
	{
		ID:"first_product", Era:7, Title:"Первый продукт вышел на рынок",
		Text:"Теперь компанию оценивают не по планам, а по тому, что она реально сделала. Первый продукт задаёт отношение к дальнейшему росту.",
		Description:"Первая продуктовая философия компании.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.Company != nil && len(st.Company.Products) >= 1 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"quality", Title:"Качество важнее скорости", Hint:"Бренд и продуктовый отдел получают преимущество.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.Brand = clampLife(st.Company.Brand + 4)
					storyDepartment(st, "product", 1)
				}
			}},
			{ID:"growth", Title:"Нужно быстрее занимать рынок", Hint:"Продажи и доля рынка растут, но компания становится агрессивнее.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.MarketShare = clampLife(st.Company.MarketShare + 4)
					storyDepartment(st, "sales", 1)
				}
			}},
		},
	},
	{
		ID:"team_culture", Era:7, Title:"Компания перестала помещаться в одной комнате",
		Text:"Людей уже достаточно много, чтобы культура перестала формироваться сама. То, что вы выберете сейчас, будет чувствоваться на следующем масштабе.",
		Description:"Выбор культуры молодой компании.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Staff >= 25 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"people", Title:"Сильная команда важнее темпа", Hint:"People-функция и бренд укрепляются.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "people", 1)
					st.Company.Brand = clampLife(st.Company.Brand + 3)
				}
			}},
			{ID:"performance", Title:"Высокая планка важнее комфорта", Hint:"Operations усиливается, но такой стиль позже увеличит давление.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "operations", 1)
					st.Company.MarketShare = clampLife(st.Company.MarketShare + 2)
				}
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 4)
			}},
		},
	},
	{
		ID:"company_crisis", Era:7, Optional:true, Title:"Компания на грани неплатёжеспособности",
		Text:"Долг стал слишком большим относительно стоимости бизнеса, а свободной кассы почти нет. Теперь речь не о росте — нужно решить, существует ли компания через несколько месяцев.",
		Description:"Настоящий риск потерять построенный бизнес без потери всей жизни.", Severity:"danger",
		Condition:func(st *LifeState) bool {
			if st.Company == nil || st.Company.Tier < 2 { return false }
			limit := max(int64(500_000), st.Company.Valuation/2)
			return st.Company.Debt >= limit && st.Company.Cash < max(int64(100_000), st.Company.Debt/10)
		},
		Choices:[]lifeStoryChoiceDef{
			{ID:"restructure", Title:"Жёстко реструктурировать компанию", Hint:"Долг уменьшается, но часть команды и бренда будет потеряна.", Apply:func(st *LifeState) {
				if st.Company == nil { return }
				cut := max(1, st.Company.Staff/4)
				st.Company.Staff = max(1, st.Company.Staff-cut)
				st.Company.Debt = st.Company.Debt * 82 / 100
				st.Company.Brand = clampLife(st.Company.Brand - 6)
				st.Company.MarketShare = clampLife(st.Company.MarketShare - 3)
				st.Reputation = clampLife(st.Reputation - 2)
			}},
			{ID:"rescue", Title:"Спасать компанию личным капиталом", Hint:"Личные деньги переходят в бизнес и гасят часть корпоративного долга.", Apply:func(st *LifeState) {
				if st.Company == nil { return }
				amount := min(st.Cash, max(int64(0), st.Company.Debt/3))
				st.Cash -= amount
				st.Company.Debt = max(int64(0), st.Company.Debt-amount)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 10)
			}},
			{ID:"bankruptcy", Title:"Признать банкротство и начать новую главу", Hint:"Компания исчезнет, но навыки, образование, связи и личная жизнь останутся.", Apply:func(st *LifeState) {
				if st.Company == nil { return }
				st.Company = nil
				st.Reputation = clampLife(st.Reputation - 10)
				st.Mood = clampLife(st.Mood - 14)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 12)
				st.Skills.Management = clampLife(st.Skills.Management + 3)
				st.Skills.Finance = clampLife(st.Skills.Finance + 3)
			}},
		},
	},
	{
		ID:"family_distance", Era:5, Optional:true, Title:"Вы почти перестали видеть близких",
		Text:"Карьерный ритм незаметно вытеснил семью из повседневной жизни. Формально ничего не случилось, но связь стала слишком слабой, чтобы это игнорировать.",
		Description:"Последствие многолетнего игнорирования семьи.", Severity:"warning",
		Condition:func(st *LifeState) bool { return lifeLevel(st) >= 35 && st.Network.FamilyBond <= 15 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"return", Title:"Осознанно вернуть близких в жизнь", Hint:"Потребует денег и времени, но сильно восстановит отношения.", Apply:func(st *LifeState) {
				changeLifeMoney(&st.Cash, &st.Debt, -15_000)
				st.Network.FamilyBond = clampLife(st.Network.FamilyBond + 28)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 6)
				st.Mood = clampLife(st.Mood + 5)
			}},
			{ID:"distance", Title:"Признать, что жизнь изменилась", Hint:"Карьерный темп сохраняется, но семейная связь продолжит слабеть.", Apply:func(st *LifeState) {
				st.Network.FamilyBond = clampLife(st.Network.FamilyBond - 5)
				st.Skills.Discipline = clampLife(st.Skills.Discipline + 2)
				st.Mood = clampLife(st.Mood - 4)
			}},
		},
	},
	{
		ID:"cofounder_conflict", Era:8, Optional:true, Title:"Сооснователи больше не одинаково видят компанию",
		Text:"То, что помогало на старте, теперь стало источником напряжения. Компания выросла, а представления о риске, найме и будущем начали расходиться.",
		Description:"Отложенное последствие выбора сооснователя.", Severity:"warning",
		Condition:func(st *LifeState) bool {
			return st.Company != nil && st.Company.Tier >= 3 && lifeStoryChoice(st, "company_birth") == "cofounder"
		},
		Choices:[]lifeStoryChoiceDef{
			{ID:"compromise", Title:"Пересобрать роли и договориться", Hint:"Требует сильной коммуникации, зато сохраняет партнёрство.", Apply:func(st *LifeState) {
				st.Skills.Communication = clampLife(st.Skills.Communication + 4)
				st.Skills.Management = clampLife(st.Skills.Management + 2)
				if st.Company != nil { st.Company.Brand = clampLife(st.Company.Brand + 2) }
			}},
			{ID:"control", Title:"Постепенно возвращать контроль", Hint:"Доля основателя растёт, но компания платит за конфликт.", Apply:func(st *LifeState) {
				if st.Company == nil { return }
				cost := max(int64(300_000), st.Company.Valuation/25)
				if storyCompanySpend(st, min(cost, st.Company.Cash)) {
					st.Company.Ownership = min(95, st.Company.Ownership+10)
				}
				st.Company.Brand = clampLife(st.Company.Brand - 2)
			}},
			{ID:"delegate", Title:"Отдать партнёру больше операционной власти", Hint:"Доля немного снижается, зато основатель разгружает себя.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.Ownership = max(51, st.Company.Ownership-5)
					storyDepartment(st, "operations", 1)
				}
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 8)
			}},
		},
	},
	{
		ID:"investor_offer", Era:8, Title:"Инвестор предлагает ускорить рост",
		Text:"Компания уже доказала, что может существовать. Внешний капитал позволит расти быстрее, но часть контроля придётся отдать.",
		Description:"Первая серьёзная развилка капитала и контроля.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Tier >= 3 && st.Company.Valuation >= 5_000_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"raise", Title:"Привлечь капитал", Hint:"Касса резко вырастет, доля основателя уменьшится.", Apply:func(st *LifeState) {
				if st.Company == nil { return }
				raise := max(int64(1_000_000), st.Company.Valuation/5)
				st.Company.Cash += raise
				st.Company.Ownership = max(51, st.Company.Ownership-15)
				st.Company.Brand = clampLife(st.Company.Brand + 2)
			}},
			{ID:"bootstrap", Title:"Расти только на своих деньгах", Hint:"Контроль сохраняется, управление и финансовая дисциплина растут.", Apply:func(st *LifeState) {
				st.Skills.Management = clampLife(st.Skills.Management + 3)
				st.Skills.Finance = clampLife(st.Skills.Finance + 3)
			}},
		},
	},
	{
		ID:"national_scale", Era:8, Title:"Компания стала слишком большой для ручного управления",
		Text:"Сотни процессов больше нельзя держать в голове. Основатель должен выбрать: строить систему или продолжать лично контролировать критические решения.",
		Description:"Переход от предпринимателя к системному CEO.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Tier >= 4 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"system", Title:"Строить систему управления", Hint:"Operations и Finance усиливаются, риск бизнеса снижается.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "operations", 2)
					storyDepartment(st, "finance", 1)
				}
				st.Skills.Management = clampLife(st.Skills.Management + 3)
			}},
			{ID:"founder_control", Title:"Ключевые решения оставлять за собой", Hint:"Инновационность выше, но личный стресс тоже.", Apply:func(st *LifeState) {
				if st.Company != nil { st.Company.Innovation = clampLife(st.Company.Innovation + 6) }
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 8)
			}},
		},
	},
	{
		ID:"international_model", Era:9, Title:"Один офис больше не понимает весь мир",
		Text:"Компания работает на нескольких рынках. Теперь нужно решить, будут ли регионы исполнять решения HQ или получат настоящую самостоятельность.",
		Description:"Формирование международной модели управления.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Company != nil && len(st.Company.Regions) >= 3 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"central", Title:"Сильный единый центр", Hint:"Finance и Legal усиливаются; контроль выше.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "finance", 1)
					storyDepartment(st, "legal", 1)
				}
			}},
			{ID:"local", Title:"Сильные локальные команды", Hint:"International и бренд получают больший потенциал.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "international", 2)
					st.Company.Brand = clampLife(st.Company.Brand + 4)
				}
			}},
		},
	},
	{
		ID:"first_acquisition", Era:9, Title:"Вы купили чужую компанию",
		Text:"На бумаге сделка уже завершена. Теперь начинается самое сложное: две команды, два набора процессов и две культуры нужно превратить в один бизнес.",
		Description:"Первая интеграция приобретённой компании.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Acquisitions >= 1 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"integrate", Title:"Быстро интегрировать всё в группу", Hint:"Operations усиливается, но бренд немного рискует.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "operations", 1)
					st.Company.Brand = clampLife(st.Company.Brand - 1)
				}
			}},
			{ID:"autonomy", Title:"Оставить компании автономию", Hint:"Бренд и инновации сохраняются лучше.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.Brand = clampLife(st.Company.Brand + 2)
					st.Company.Innovation = clampLife(st.Company.Innovation + 3)
				}
			}},
		},
	},
	{
		ID:"ipo_question", Era:9, Title:"Капитал или контроль?",
		Text:"Компания достаточно большая для публичного рынка. IPO может дать огромный капитал, но после него основатель уже не единственный человек, которому компания должна отвечать.",
		Description:"Подготовка к главному корпоративному выбору.", Severity:"warning",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Tier >= 6 && !st.Company.Public && lifeLevel(st) >= 90 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"public", Title:"Готовить компанию к публичному рынку", Hint:"Finance, Legal и репутация усиливаются.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "finance", 1)
					storyDepartment(st, "legal", 1)
					st.Company.Brand = clampLife(st.Company.Brand + 2)
				}
				st.Reputation = clampLife(st.Reputation + 3)
			}},
			{ID:"private", Title:"Контроль важнее внешнего капитала", Hint:"Доля не меняется, управление и финансовая независимость растут.", Apply:func(st *LifeState) {
				st.Skills.Management = clampLife(st.Skills.Management + 3)
				st.Skills.Finance = clampLife(st.Skills.Finance + 3)
			}},
		},
	},
	{
		ID:"ipo_aftermath", Era:9, Title:"Теперь у компании тысячи новых владельцев",
		Text:"IPO завершено. Цена решений изменилась: рынок оценивает не только результат, но и ожидания, прозрачность и доверие к руководству.",
		Description:"Переход к жизни публичной компании.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Public },
		Choices:[]lifeStoryChoiceDef{
			{ID:"growth", Title:"Обещать рынку быстрый рост", Hint:"Бренд и доля рынка растут, но давление на компанию усиливается.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.Brand = clampLife(st.Company.Brand + 4)
					st.Company.MarketShare = clampLife(st.Company.MarketShare + 3)
				}
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 6)
			}},
			{ID:"governance", Title:"Сначала построить сильное управление", Hint:"Legal и Finance становятся сильнее, репутация устойчивее.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "legal", 1)
					storyDepartment(st, "finance", 1)
				}
				st.Reputation = clampLife(st.Reputation + 4)
			}},
		},
	},
	{
		ID:"global_owner", Era:10, Title:"Вы построили транснациональную корпорацию",
		Text:"Когда-то вопрос стоял в том, хватит ли денег на еду. Теперь от ваших решений зависят десятки тысяч сотрудников и огромные рынки. Это вершина сюжетной лестницы, но не конец сохранения.",
		Description:"Переход в бесконечный endgame владельца ТНК.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Tier >= 7 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"innovation", Title:"Продолжать строить новое", Hint:"Инновации и технологии становятся главным наследием.", Apply:func(st *LifeState) {
				if st.Company != nil {
					st.Company.Innovation = clampLife(st.Company.Innovation + 10)
					storyDepartment(st, "technology", 2)
				}
			}},
			{ID:"institution", Title:"Сделать компанию сильнее основателя", Hint:"Управление и корпоративные функции становятся устойчивее.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "operations", 2)
					storyDepartment(st, "people", 2)
					storyDepartment(st, "legal", 1)
				}
			}},
			{ID:"legacy", Title:"Думать о личном наследии", Hint:"Репутация и отношения с близкими получают финальный большой импульс.", Apply:func(st *LifeState) {
				st.Reputation = clampLife(st.Reputation + 10)
				st.Network.FamilyBond = clampLife(st.Network.FamilyBond + 15)
				st.Network.Relationship = clampLife(st.Network.Relationship + 10)
			}},
		},
	},
	{
		ID:"succession", Era:10, Optional:true, Title:"Нужна ли компании жизнь без основателя?",
		Text:"На глобальном масштабе личный контроль становится отдельным риском. Сильнейшая компания должна переживать смену одного человека — даже если этот человек её создал.",
		Description:"Поздний выбор между founder-led и институциональной компанией.", Severity:"warning",
		Condition:func(st *LifeState) bool {
			return st.Company != nil && st.Company.Tier >= 7 && lifeStoryDone(st, "global_owner")
		},
		Choices:[]lifeStoryChoiceDef{
			{ID:"founder_ceo", Title:"Оставаться главным оператором компании", Hint:"Инновационность выше, но личное давление остаётся огромным.", Apply:func(st *LifeState) {
				if st.Company != nil { st.Company.Innovation = clampLife(st.Company.Innovation + 6) }
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + 7)
				st.Skills.Management = clampLife(st.Skills.Management + 3)
			}},
			{ID:"professional_ceo", Title:"Передать операционное управление профессиональному CEO", Hint:"Компания становится устойчивее, а личный стресс снижается.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "operations", 2)
					storyDepartment(st, "people", 1)
				}
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 12)
				st.Reputation = clampLife(st.Reputation + 3)
			}},
			{ID:"chairman", Title:"Остаться председателем и владельцем", Hint:"Фокус смещается на стратегию, капитал и совет директоров.", Apply:func(st *LifeState) {
				if st.Company != nil {
					storyDepartment(st, "finance", 1)
					storyDepartment(st, "legal", 1)
				}
				st.Skills.Finance = clampLife(st.Skills.Finance + 4)
				st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 7)
			}},
		},
	},
	{
		ID:"hundred_billion", Era:10, Title:"Компания переросла первоначальную мечту",
		Text:"Стоимость группы превысила 100 млрд ₽. Дальше нет обязательной победной кнопки: можно удерживать империю, создавать новые продукты, покупать компании или переживать новые кризисы.",
		Description:"Финальная сюжетная веха и открытие бесконечной игры.", Severity:"good",
		Condition:func(st *LifeState) bool { return st.Company != nil && st.Company.Tier >= 7 && st.Company.Valuation >= 100_000_000_000 },
		Choices:[]lifeStoryChoiceDef{
			{ID:"continue", Title:"Продолжить эту жизнь", Hint:"Сюжетная лестница завершена, симуляция продолжается без финального сброса.", Apply:func(st *LifeState) {
				st.Mood = clampLife(st.Mood + 10)
				st.Reputation = clampLife(st.Reputation + 5)
				lifeAwardXP(st, 15_000)
			}},
		},
	},
}

func normalizeLifeStory(st *LifeState) {
	if st.Story.Completed == nil { st.Story.Completed = []string{} }
	if st.Story.Choices == nil { st.Story.Choices = map[string]string{} }
	if st.Story.Patterns == nil { st.Story.Patterns = map[string]int{} }
	if st.Version >= 3 { return }

	currentEra := lifeEraForLevel(lifeLevel(st)).Stage
	for _, node := range lifeStoryNodes {
		// Optional/contextual scenes are possibilities, not mandatory historical
		// checkpoints. Old saves should not serialize thousands of synthetic
		// "legacy" completions just because the player is already in a later era.
		if node.Optional || node.Era >= currentEra || lifeStoryDone(st, node.ID) { continue }
		st.Story.Completed = append(st.Story.Completed, node.ID)
		st.Story.Choices[node.ID] = "legacy"
	}
}

func lifeStoryDone(st *LifeState, id string) bool {
	// Every normal completion is also recorded in Choices. Use that map first so
	// the 8k-scene catalog does not repeatedly scan an ever-growing slice.
	if st.Story.Choices != nil {
		if _, ok := st.Story.Choices[id]; ok { return true }
	}
	// Compatibility with very old saves that may contain Completed without a
	// matching Choices entry.
	for _, done := range st.Story.Completed {
		if done == id { return true }
	}
	return false
}

func lifeStoryChoice(st *LifeState, id string) string {
	if st.Story.Choices == nil { return "" }
	return st.Story.Choices[id]
}

func findLifeStoryNode(id string) (lifeStoryNodeDef, bool) {
	for _, node := range lifeStoryNodes {
		if node.ID == id { return node, true }
	}
	return lifeStoryNodeDef{}, false
}

func maybeLifeStory(st *LifeState, now time.Time) bool {
	normalizeLifeStory(st)
	if st.PendingEvent != nil || st.Active != nil { return false }
	for _, node := range lifeStoryNodes {
		if lifeStoryDone(st, node.ID) || node.Condition == nil || !node.Condition(st) { continue }
		pending := &LifePendingEvent{
			ID:"story:"+node.ID,
			Kind:"story",
			StoryID:node.ID,
			Title:node.Title,
			Text:lifeStoryRenderedText(st, node),
			Severity:node.Severity,
		}
		for _, choice := range node.Choices {
			pending.Options = append(pending.Options, LifeEventOption{ID:choice.ID, Title:choice.Title, Hint:choice.Hint})
		}
		st.PendingEvent = pending
		lifeHistory(st, now, "story", node.Title, "Жизненный поворот требует решения.")
		return true
	}
	return false
}

func lifeResolveStoryChoice(st *LifeState, nodeID, choiceID string, now time.Time) error {
	node, ok := findLifeStoryNode(nodeID)
	if !ok { return ErrInput }
	if lifeStoryDone(st, nodeID) { return ErrLifeLocked }
	for _, choice := range node.Choices {
		if choice.ID != choiceID { continue }
		if choice.Apply != nil { choice.Apply(st) }
		st.Story.Completed = append(st.Story.Completed, nodeID)
		if st.Story.Choices == nil { st.Story.Choices = map[string]string{} }
		st.Story.Choices[nodeID] = choiceID
		st.Story.LastBeatDay = st.Days
		st.PendingEvent = nil
		lifeAwardXP(st, int64(180+node.Era*node.Era*35))
		lifeHistory(st, now, "story", node.Title, fmt.Sprintf("Решение: %s", choice.Title))
		return nil
	}
	return ErrInput
}

func lifeStoryView(st LifeState) LifeStoryView {
	normalizeLifeStory(&st)
	view := LifeStoryView{
		Completed:len(st.Story.Completed),
		Total:len(lifeStoryNodes),
		Choices:st.Story.Choices,
	}
	for i := len(st.Story.Completed)-1; i >= 0; i-- {
		if node, ok := findLifeStoryNode(st.Story.Completed[i]); ok {
			view.LastBeat = &LifeStoryBeatView{ID:node.ID, Era:node.Era, Title:node.Title, Description:node.Description}
			break
		}
	}
	for _, node := range lifeStoryNodes {
		if lifeStoryDone(&st, node.ID) || node.Condition == nil || !node.Condition(&st) { continue }
		view.NextBeat = &LifeStoryBeatView{ID:node.ID, Era:node.Era, Title:node.Title, Description:node.Description}
		return view
	}
	for _, node := range lifeStoryNodes {
		if lifeStoryDone(&st, node.ID) || node.Optional { continue }
		view.NextBeat = &LifeStoryBeatView{ID:node.ID, Era:node.Era, Title:node.Title, Description:node.Description}
		break
	}
	return view
}
