package games

type LifeCareerOption struct {
	ID               string     `json:"id"`
	Track            string     `json:"track"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Salary           int64      `json:"salary"`
	MinLevel         int        `json:"min_level"`
	InterviewSeconds int64      `json:"interview_seconds"`
	WorkSeconds      int64      `json:"work_seconds"`
	MinEducation     int        `json:"min_education"`
	MinExperience    int        `json:"min_experience"`
	MinReputation    int        `json:"min_reputation"`
	MinSkills        LifeSkills `json:"min_skills"`
}

type LifeAssetOption struct {
	ID          string `json:"id"`
	Category    string `json:"category"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Cost        int64  `json:"cost"`
	EnergyBonus int    `json:"energy_bonus"`
	MoodBonus   int    `json:"mood_bonus"`
	WorkBonus   int    `json:"work_bonus"`
	StatusBonus int    `json:"status_bonus"`
}

type LifeInvestmentOption struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Risk        int    `json:"risk"`
	ReturnBPS   int    `json:"return_bps"`
	MinAmount   int64  `json:"min_amount"`
	MinFinance  int    `json:"min_finance"`
}

type LifeHobbyOption struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Cost            int64      `json:"cost"`
	DurationSeconds int64      `json:"duration_seconds"`
	GameDays        int        `json:"game_days"`
	StressChange    int        `json:"stress_change"`
	FitnessChange   int        `json:"fitness_change"`
	SocialChange    int        `json:"social_change"`
	MoodChange      int        `json:"mood_change"`
	SkillGain       LifeSkills `json:"skill_gain"`
}

type LifeCertificationOption struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Cost            int64      `json:"cost"`
	DurationSeconds int64      `json:"duration_seconds"`
	GameDays        int        `json:"game_days"`
	MinEducation    int        `json:"min_education"`
	MinSkills       LifeSkills `json:"min_skills"`
	SkillGain       LifeSkills `json:"skill_gain"`
}

type LifeSocialOption struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	Cost            int64  `json:"cost"`
	DurationSeconds int64  `json:"duration_seconds"`
	GameDays        int    `json:"game_days"`
	Friends         int    `json:"friends"`
	Contacts        int    `json:"contacts"`
	Family          int    `json:"family"`
	Relationship    int    `json:"relationship"`
	StressChange    int    `json:"stress_change"`
	MoodChange      int    `json:"mood_change"`
}

type LifeBusinessIndustryOption struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	EntryCost   int64  `json:"entry_cost"`
	Volatility  int    `json:"volatility"`
	MarginBonus int    `json:"margin_bonus"`
	TechWeight  int    `json:"tech_weight"`
}

type LifeDepartmentOption struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	BaseCost    int64  `json:"base_cost"`
}

type LifeRegionOption struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	MinTier     int    `json:"min_tier"`
	Cost        int64  `json:"cost"`
	BrandNeed   int    `json:"brand_need"`
}

type LifeProductOption struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	MinTier     int    `json:"min_tier"`
	LaunchCost  int64  `json:"launch_cost"`
	BuildSeconds int64 `json:"build_seconds"`
	BaseRevenue int64  `json:"base_revenue"`
	InnovationNeed int `json:"innovation_need"`
}

type LifeExpansionCatalog struct {
	Careers        []LifeCareerOption           `json:"careers"`
	Assets         []LifeAssetOption            `json:"assets"`
	Investments    []LifeInvestmentOption       `json:"investments"`
	Hobbies        []LifeHobbyOption            `json:"hobbies"`
	Certifications []LifeCertificationOption    `json:"certifications"`
	Social         []LifeSocialOption           `json:"social"`
	Industries     []LifeBusinessIndustryOption `json:"industries"`
	Departments []LifeDepartmentOption      `json:"departments"`
	Regions     []LifeRegionOption          `json:"regions"`
	Products    []LifeProductOption         `json:"products"`
}

var lifeCareerOptions = []LifeCareerOption{
	{ID:"retail_worker", Track:"operations", Title:"Сотрудник магазина", Description:"Первая постоянная работа с фиксированной зарплатой.", Salary:42000, InterviewSeconds:60, WorkSeconds:240, MinExperience:4, MinSkills:LifeSkills{Discipline:12,Communication:10}},
	{ID:"shift_lead", Track:"operations", Title:"Старший смены", Description:"Ответственность за небольшую команду и смену.", Salary:62000, InterviewSeconds:90, WorkSeconds:300, MinExperience:10, MinReputation:3, MinSkills:LifeSkills{Discipline:18,Communication:16,Management:8}},
	{ID:"store_manager", Track:"operations", Title:"Управляющий точкой", Description:"План, люди, показатели и операционная дисциплина.", Salary:95000, InterviewSeconds:120, WorkSeconds:360, MinEducation:1, MinExperience:20, MinReputation:8, MinSkills:LifeSkills{Management:22,Communication:24,Finance:14}},
	{ID:"area_manager", Track:"operations", Title:"Региональный менеджер", Description:"Управление несколькими командами и P&L.", Salary:180000, InterviewSeconds:180, WorkSeconds:480, MinEducation:2, MinExperience:45, MinReputation:18, MinSkills:LifeSkills{Management:42,Finance:32,Communication:38}},

	{ID:"tech_intern", Track:"tech", Title:"Стажёр-разработчик", Description:"Первые коммерческие задачи и код-ревью.", Salary:55000, InterviewSeconds:90, WorkSeconds:300, MinEducation:1, MinExperience:8, MinSkills:LifeSkills{Digital:22,Discipline:16}},
	{ID:"junior_dev", Track:"tech", Title:"Junior-разработчик", Description:"Работа над небольшими фичами в продуктовой команде.", Salary:90000, InterviewSeconds:120, WorkSeconds:360, MinEducation:1, MinExperience:14, MinSkills:LifeSkills{Digital:32,Discipline:20}},
	{ID:"middle_dev", Track:"tech", Title:"Middle-разработчик", Description:"Самостоятельная разработка и ответственность за модули.", Salary:170000, InterviewSeconds:180, WorkSeconds:480, MinEducation:2, MinExperience:30, MinReputation:8, MinSkills:LifeSkills{Digital:48,Discipline:30,Communication:22}},
	{ID:"senior_dev", Track:"tech", Title:"Senior-разработчик", Description:"Архитектура, сложные задачи и наставничество.", Salary:290000, InterviewSeconds:240, WorkSeconds:600, MinEducation:2, MinExperience:50, MinReputation:16, MinSkills:LifeSkills{Digital:65,Discipline:42,Communication:34}},
	{ID:"tech_lead", Track:"tech", Title:"Tech Lead", Description:"Техническое лидерство и управление разработкой.", Salary:430000, InterviewSeconds:300, WorkSeconds:720, MinEducation:2, MinExperience:72, MinReputation:26, MinSkills:LifeSkills{Digital:75,Management:50,Communication:48}},
	{ID:"cto", Track:"tech", Title:"CTO", Description:"Технологическая стратегия большой компании.", Salary:850000, InterviewSeconds:420, WorkSeconds:900, MinEducation:3, MinExperience:115, MinReputation:48, MinSkills:LifeSkills{Digital:88,Management:76,Finance:58,Communication:68}},

	{ID:"data_intern", Track:"data", Title:"Стажёр-аналитик", Description:"Таблицы, базовые метрики и подготовка отчётов.", Salary:52000, InterviewSeconds:90, WorkSeconds:300, MinEducation:1, MinExperience:8, MinSkills:LifeSkills{Digital:20,Finance:12}},
	{ID:"data_analyst", Track:"data", Title:"Аналитик", Description:"Метрики, исследования и выводы для продукта.", Salary:120000, InterviewSeconds:150, WorkSeconds:420, MinEducation:1, MinExperience:20, MinSkills:LifeSkills{Digital:38,Finance:24,Communication:20}},
	{ID:"senior_analyst", Track:"data", Title:"Senior-аналитик", Description:"Сложная аналитика и влияние на стратегию.", Salary:230000, InterviewSeconds:210, WorkSeconds:540, MinEducation:2, MinExperience:42, MinReputation:12, MinSkills:LifeSkills{Digital:58,Finance:42,Communication:32}},
	{ID:"head_data", Track:"data", Title:"Head of Data", Description:"Команда аналитики, данные и решения для бизнеса.", Salary:480000, InterviewSeconds:300, WorkSeconds:720, MinEducation:3, MinExperience:78, MinReputation:28, MinSkills:LifeSkills{Digital:72,Finance:55,Management:55,Communication:48}},

	{ID:"sales_rep", Track:"sales", Title:"Менеджер продаж", Description:"Переговоры, воронка и первые коммерческие сделки.", Salary:65000, InterviewSeconds:90, WorkSeconds:300, MinExperience:8, MinSkills:LifeSkills{Communication:20,Discipline:14}},
	{ID:"account_manager", Track:"sales", Title:"Account Manager", Description:"Ведение клиентов и развитие долгосрочных отношений.", Salary:110000, InterviewSeconds:120, WorkSeconds:360, MinExperience:18, MinReputation:6, MinSkills:LifeSkills{Communication:34,Discipline:22,Finance:14}},
	{ID:"key_account", Track:"sales", Title:"Key Account Manager", Description:"Крупные клиенты и дорогие переговоры.", Salary:210000, InterviewSeconds:180, WorkSeconds:480, MinEducation:1, MinExperience:38, MinReputation:14, MinSkills:LifeSkills{Communication:55,Finance:30,Discipline:32}},
	{ID:"sales_head", Track:"sales", Title:"Head of Sales", Description:"Команда продаж, план и коммерческая стратегия.", Salary:360000, InterviewSeconds:240, WorkSeconds:600, MinEducation:2, MinExperience:62, MinReputation:24, MinSkills:LifeSkills{Communication:68,Management:55,Finance:42}},
	{ID:"commercial_director", Track:"sales", Title:"Коммерческий директор", Description:"Вся выручка, цены, продажи и маркетинг.", Salary:650000, InterviewSeconds:360, WorkSeconds:840, MinEducation:3, MinExperience:95, MinReputation:40, MinSkills:LifeSkills{Communication:78,Management:70,Finance:66}},

	{ID:"finance_assistant", Track:"finance", Title:"Финансовый ассистент", Description:"Первый шаг в финансовую функцию.", Salary:60000, InterviewSeconds:90, WorkSeconds:300, MinEducation:1, MinExperience:8, MinSkills:LifeSkills{Finance:20,Discipline:16}},
	{ID:"accountant", Track:"finance", Title:"Бухгалтер", Description:"Учёт, документы и финансовая дисциплина.", Salary:95000, InterviewSeconds:120, WorkSeconds:360, MinEducation:1, MinExperience:18, MinSkills:LifeSkills{Finance:32,Discipline:26}},
	{ID:"financial_analyst", Track:"finance", Title:"Финансовый аналитик", Description:"Модели, бюджеты и оценка эффективности.", Salary:160000, InterviewSeconds:180, WorkSeconds:480, MinEducation:2, MinExperience:30, MinSkills:LifeSkills{Finance:48,Digital:34,Discipline:30}},
	{ID:"finance_manager", Track:"finance", Title:"Финансовый менеджер", Description:"Бюджетирование, отчётность и решения.", Salary:270000, InterviewSeconds:240, WorkSeconds:600, MinEducation:2, MinExperience:50, MinReputation:15, MinSkills:LifeSkills{Finance:62,Management:40,Communication:34}},
	{ID:"finance_director", Track:"finance", Title:"Финансовый директор", Description:"Финансовая стратегия и устойчивость бизнеса.", Salary:520000, InterviewSeconds:330, WorkSeconds:780, MinEducation:3, MinExperience:82, MinReputation:30, MinSkills:LifeSkills{Finance:78,Management:62,Communication:50}},
	{ID:"cfo", Track:"finance", Title:"CFO", Description:"Финансы корпорации, капитал и инвесторы.", Salary:900000, InterviewSeconds:480, WorkSeconds:960, MinEducation:4, MinExperience:120, MinReputation:50, MinSkills:LifeSkills{Finance:90,Management:78,Communication:66}},

	{ID:"project_coordinator", Track:"management", Title:"Координатор проектов", Description:"Сроки, коммуникация и первые процессы.", Salary:80000, InterviewSeconds:90, WorkSeconds:330, MinEducation:1, MinExperience:12, MinSkills:LifeSkills{Discipline:24,Communication:22}},
	{ID:"project_manager", Track:"management", Title:"Project Manager", Description:"Команда, сроки, риски и ответственность.", Salary:150000, InterviewSeconds:150, WorkSeconds:420, MinEducation:1, MinExperience:28, MinReputation:8, MinSkills:LifeSkills{Management:32,Communication:38,Discipline:32}},
	{ID:"product_manager", Track:"management", Title:"Product Manager", Description:"Пользователи, продукт, метрики и приоритеты.", Salary:230000, InterviewSeconds:210, WorkSeconds:540, MinEducation:2, MinExperience:40, MinReputation:12, MinSkills:LifeSkills{Management:42,Digital:42,Communication:45,Finance:28}},
	{ID:"head_product", Track:"management", Title:"Head of Product", Description:"Портфель продуктов и несколько команд.", Salary:450000, InterviewSeconds:300, WorkSeconds:720, MinEducation:3, MinExperience:72, MinReputation:28, MinSkills:LifeSkills{Management:65,Digital:58,Communication:58,Finance:42}},
	{ID:"coo", Track:"management", Title:"COO", Description:"Операционная система всей компании.", Salary:820000, InterviewSeconds:420, WorkSeconds:900, MinEducation:4, MinExperience:110, MinReputation:48, MinSkills:LifeSkills{Management:86,Finance:68,Communication:70,Discipline:72}},
}

var lifeAssetOptions = []LifeAssetOption{
	{ID:"basic_laptop", Category:"device", Title:"Подержанный ноутбук", Description:"Позволяет нормально учиться и брать цифровые заказы.", Cost:18000, WorkBonus:2},
	{ID:"work_laptop", Category:"device", Title:"Рабочий ноутбук", Description:"Быстрее и надёжнее для профессиональной работы.", Cost:85000, WorkBonus:5, MoodBonus:1},
	{ID:"pro_setup", Category:"device", Title:"Профессиональное рабочее место", Description:"Техника и периферия для дорогих проектов.", Cost:280000, WorkBonus:9, MoodBonus:2},
	{ID:"bike", Category:"transport", Title:"Велосипед", Description:"Дешёвый транспорт и немного физической активности.", Cost:25000, EnergyBonus:2},
	{ID:"used_car", Category:"transport", Title:"Подержанный автомобиль", Description:"Экономит силы на работе и повышает мобильность.", Cost:650000, EnergyBonus:4, StatusBonus:1},
	{ID:"reliable_car", Category:"transport", Title:"Надёжный автомобиль", Description:"Комфортнее ежедневная жизнь и деловые поездки.", Cost:2400000, EnergyBonus:7, StatusBonus:2, MoodBonus:2},
	{ID:"premium_car", Category:"transport", Title:"Премиальный автомобиль", Description:"Статусный актив поздней игры.", Cost:14000000, EnergyBonus:8, StatusBonus:5, MoodBonus:4},
	{ID:"capsule_wardrobe", Category:"wardrobe", Title:"Базовый гардероб", Description:"Аккуратный внешний вид для собеседований.", Cost:30000, StatusBonus:1},
	{ID:"business_wardrobe", Category:"wardrobe", Title:"Деловой гардероб", Description:"Лучше подходит для переговоров и руководящих ролей.", Cost:180000, StatusBonus:3, MoodBonus:1},
	{ID:"executive_wardrobe", Category:"wardrobe", Title:"Гардероб руководителя", Description:"Имидж для верхнего уровня бизнеса.", Cost:1200000, StatusBonus:6, MoodBonus:2},
}

var lifeInvestmentOptions = []LifeInvestmentOption{
	{ID:"deposit", Title:"Накопительный счёт", Description:"Очень низкий риск и небольшая доходность.", Risk:1, ReturnBPS:350, MinAmount:1000, MinFinance:5},
	{ID:"bonds", Title:"Облигационный портфель", Description:"Спокойный инструмент для сохранения капитала.", Risk:2, ReturnBPS:650, MinAmount:5000, MinFinance:15},
	{ID:"index", Title:"Широкий индекс", Description:"Диверсифицированный рынок с умеренными колебаниями.", Risk:4, ReturnBPS:950, MinAmount:10000, MinFinance:24},
	{ID:"dividend", Title:"Дивидендный портфель", Description:"Доходные компании и средний риск.", Risk:5, ReturnBPS:1150, MinAmount:25000, MinFinance:34},
	{ID:"growth", Title:"Портфель роста", Description:"Выше потенциальная доходность и заметно выше просадки.", Risk:7, ReturnBPS:1600, MinAmount:50000, MinFinance:48},
	{ID:"venture", Title:"Венчурный пул", Description:"Поздняя игра: высокий риск и редкие крупные результаты.", Risk:10, ReturnBPS:2600, MinAmount:500000, MinFinance:72},
}

var lifeHobbyOptions = []LifeHobbyOption{
	{ID:"walk", Title:"Долгая прогулка", Description:"Бесплатно разгружает голову.", DurationSeconds:120, GameDays:1, StressChange:-8, FitnessChange:1, MoodChange:4},
	{ID:"gym", Title:"Тренировка", Description:"Физическая форма и защита от выгорания.", Cost:600, DurationSeconds:180, GameDays:1, StressChange:-4, FitnessChange:5, MoodChange:2},
	{ID:"reading", Title:"Чтение", Description:"Медленный, но стабильный рост кругозора.", Cost:300, DurationSeconds:150, GameDays:1, StressChange:-3, MoodChange:2, SkillGain:LifeSkills{Discipline:1,Finance:1}},
	{ID:"language_club", Title:"Разговорный клуб", Description:"Общение и полезные знакомства.", Cost:1200, DurationSeconds:210, GameDays:2, StressChange:-2, SocialChange:4, MoodChange:3, SkillGain:LifeSkills{Communication:2}},
	{ID:"volunteering", Title:"Волонтёрство", Description:"Связи, настроение и репутация.", DurationSeconds:240, GameDays:2, StressChange:-3, SocialChange:5, MoodChange:4, SkillGain:LifeSkills{Communication:1}},
	{ID:"creative", Title:"Творческий вечер", Description:"Переключиться с работы и восстановиться.", Cost:900, DurationSeconds:180, GameDays:1, StressChange:-9, MoodChange:6},
	{ID:"networking", Title:"Профессиональный митап", Description:"Контакты, идеи и карьерные возможности.", Cost:2500, DurationSeconds:240, GameDays:2, StressChange:2, SocialChange:7, MoodChange:2, SkillGain:LifeSkills{Communication:2,Management:1}},
	{ID:"short_trip", Title:"Небольшая поездка", Description:"Дороже, но хорошо восстанавливает настроение.", Cost:18000, DurationSeconds:900, GameDays:5, StressChange:-18, FitnessChange:1, SocialChange:3, MoodChange:12},
}

var lifeCertificationOptions = []LifeCertificationOption{
	{ID:"office", Title:"Офисные инструменты", Description:"Таблицы, документы, презентации и базовая автоматизация.", Cost:3500, DurationSeconds:240, GameDays:14, SkillGain:LifeSkills{Digital:4,Discipline:2}},
	{ID:"data_basic", Title:"Основы аналитики", Description:"Метрики, визуализация и постановка вопросов к данным.", Cost:9000, DurationSeconds:360, GameDays:21, MinEducation:1, MinSkills:LifeSkills{Digital:15}, SkillGain:LifeSkills{Digital:6,Finance:2}},
	{ID:"sql", Title:"SQL и базы данных", Description:"Работа с данными для аналитической и продуктовой карьеры.", Cost:18000, DurationSeconds:480, GameDays:30, MinEducation:1, MinSkills:LifeSkills{Digital:24}, SkillGain:LifeSkills{Digital:8}},
	{ID:"frontend", Title:"Web-разработка", Description:"Практическая квалификация для первой IT-работы.", Cost:25000, DurationSeconds:600, GameDays:45, MinEducation:1, MinSkills:LifeSkills{Digital:24,Discipline:18}, SkillGain:LifeSkills{Digital:10,Discipline:2}},
	{ID:"finance_modeling", Title:"Финансовое моделирование", Description:"Модели, бюджеты и оценка инвестиционных решений.", Cost:32000, DurationSeconds:660, GameDays:45, MinEducation:1, MinSkills:LifeSkills{Finance:28,Digital:22}, SkillGain:LifeSkills{Finance:9,Digital:3}},
	{ID:"sales", Title:"Сложные продажи", Description:"Переговоры, воронки и работа с крупными клиентами.", Cost:28000, DurationSeconds:540, GameDays:30, MinSkills:LifeSkills{Communication:28}, SkillGain:LifeSkills{Communication:8,Finance:2}},
	{ID:"project", Title:"Управление проектами", Description:"Риски, сроки, команда и декомпозиция.", Cost:45000, DurationSeconds:720, GameDays:60, MinEducation:1, MinSkills:LifeSkills{Discipline:28,Communication:24}, SkillGain:LifeSkills{Management:8,Discipline:4}},
	{ID:"product", Title:"Продуктовое управление", Description:"Пользователь, метрики, приоритеты и экономика продукта.", Cost:70000, DurationSeconds:900, GameDays:75, MinEducation:2, MinSkills:LifeSkills{Digital:38,Communication:34,Finance:24}, SkillGain:LifeSkills{Management:8,Digital:5,Finance:4}},
	{ID:"leadership", Title:"Лидерство", Description:"Обратная связь, найм и управление сильными людьми.", Cost:85000, DurationSeconds:900, GameDays:60, MinEducation:2, MinSkills:LifeSkills{Management:34,Communication:40}, SkillGain:LifeSkills{Management:10,Communication:5}},
	{ID:"strategy", Title:"Корпоративная стратегия", Description:"Конкуренция, рынки и портфель направлений.", Cost:180000, DurationSeconds:1200, GameDays:90, MinEducation:3, MinSkills:LifeSkills{Management:55,Finance:45}, SkillGain:LifeSkills{Management:10,Finance:8}},
	{ID:"international", Title:"Международный бизнес", Description:"Выход на рынки, партнёры и трансграничная операционка.", Cost:300000, DurationSeconds:1500, GameDays:120, MinEducation:3, MinSkills:LifeSkills{Management:62,Communication:55,Finance:50}, SkillGain:LifeSkills{Management:8,Communication:8,Finance:6}},
	{ID:"board", Title:"Работа совета директоров", Description:"Управление капиталом, рисками и собственниками на верхнем уровне.", Cost:900000, DurationSeconds:2400, GameDays:180, MinEducation:4, MinSkills:LifeSkills{Management:78,Finance:72,Communication:65}, SkillGain:LifeSkills{Management:10,Finance:10,Communication:5}},
}

var lifeSocialOptions = []LifeSocialOption{
	{ID:"call_family", Title:"Позвонить близким", Description:"Поддерживает связь с семьёй и немного снижает стресс.", DurationSeconds:60, GameDays:1, Family:5, StressChange:-3, MoodChange:3},
	{ID:"meet_friend", Title:"Встретиться с другом", Description:"Время без пользы для карьеры — но с пользой для жизни.", Cost:900, DurationSeconds:150, GameDays:1, Friends:1, StressChange:-7, MoodChange:6},
	{ID:"new_people", Title:"Познакомиться с новыми людьми", Description:"Может расширить круг общения.", Cost:1200, DurationSeconds:180, GameDays:2, Friends:1, Contacts:1, StressChange:-2, MoodChange:3},
	{ID:"professional_dinner", Title:"Деловой ужин", Description:"Дорого, зато хорошо растит профессиональную сеть.", Cost:6500, DurationSeconds:240, GameDays:2, Contacts:4, StressChange:2, MoodChange:2},
	{ID:"mentor_search", Title:"Искать наставника", Description:"Шанс построить сильную профессиональную связь.", Cost:8000, DurationSeconds:300, GameDays:5, Contacts:2, StressChange:1, MoodChange:2},
	{ID:"date", Title:"Сходить на свидание", Description:"Романтическая линия требует времени, денег и социального ресурса.", Cost:3500, DurationSeconds:240, GameDays:2, Relationship:6, StressChange:-4, MoodChange:6},
	{ID:"weekend_together", Title:"Провести выходные вместе", Description:"Сильно поддерживает отношения, но занимает время.", Cost:12000, DurationSeconds:600, GameDays:4, Relationship:12, StressChange:-10, MoodChange:10},
	{ID:"family_trip", Title:"Поездка к близким", Description:"Большой вклад в отношения с семьёй.", Cost:22000, DurationSeconds:900, GameDays:5, Family:18, StressChange:-9, MoodChange:8},
}

var lifeBusinessIndustries = []LifeBusinessIndustryOption{
	{ID:"services", Title:"Профессиональные услуги", Description:"Низкий порог входа, высокая зависимость от команды.", EntryCost:0, Volatility:3, MarginBonus:1},
	{ID:"software", Title:"Software / SaaS", Description:"Дорогая разработка, зато масштабируемая экономика.", EntryCost:250000, Volatility:6, MarginBonus:5, TechWeight:8},
	{ID:"logistics", Title:"Логистика", Description:"Операционно сложный бизнес с большим штатом.", EntryCost:500000, Volatility:5, MarginBonus:2},
	{ID:"retail", Title:"Ритейл", Description:"Понятный спрос, но тонкая маржа и много операций.", EntryCost:350000, Volatility:4, MarginBonus:-2},
	{ID:"education", Title:"Образование", Description:"Репутация и качество продукта особенно важны.", EntryCost:180000, Volatility:3, MarginBonus:2},
	{ID:"media", Title:"Медиа", Description:"Быстрый рост бренда и очень непредсказуемый спрос.", EntryCost:220000, Volatility:8, MarginBonus:3},
	{ID:"manufacturing", Title:"Производство", Description:"Капиталоёмко, но сильная поздняя экономика.", EntryCost:1500000, Volatility:5, MarginBonus:4},
	{ID:"fintech", Title:"Финтех", Description:"Высокие требования к финансам, технологиям и контролю.", EntryCost:3000000, Volatility:7, MarginBonus:6, TechWeight:7},
}

var lifeDepartmentOptions = []LifeDepartmentOption{
	{ID:"sales", Title:"Продажи", Description:"Увеличивает вероятность сильных коммерческих месяцев.", BaseCost:100000},
	{ID:"marketing", Title:"Маркетинг", Description:"Ускоряет рост бренда.", BaseCost:120000},
	{ID:"product", Title:"Продукт", Description:"Повышает качество запусков.", BaseCost:160000},
	{ID:"technology", Title:"Технологии", Description:"Увеличивает инновационность компании.", BaseCost:200000},
	{ID:"operations", Title:"Операции", Description:"Снижает риск плохого месяца.", BaseCost:140000},
	{ID:"finance", Title:"Финансы", Description:"Снижает потери и повышает устойчивость.", BaseCost:180000},
	{ID:"people", Title:"Люди", Description:"Помогает большой команде работать стабильнее.", BaseCost:130000},
	{ID:"legal", Title:"Юридический блок", Description:"Снижает потери от сложных корпоративных событий.", BaseCost:220000},
	{ID:"international", Title:"Международное развитие", Description:"Нужно для выхода на зарубежные рынки.", BaseCost:500000},
}

var lifeRegionOptions = []LifeRegionOption{
	{ID:"home", Title:"Домашний регион", Description:"Первый рынок компании.", MinTier:1, Cost:0},
	{ID:"country", Title:"Вся страна", Description:"Национальный рынок и новые города.", MinTier:3, Cost:5000000, BrandNeed:20},
	{ID:"europe", Title:"Европа", Description:"Зрелый международный рынок.", MinTier:5, Cost:180000000, BrandNeed:48},
	{ID:"asia", Title:"Азия", Description:"Большой и разнообразный рынок.", MinTier:5, Cost:240000000, BrandNeed:52},
	{ID:"middle_east", Title:"Ближний Восток", Description:"Рынок с крупными корпоративными контрактами.", MinTier:5, Cost:160000000, BrandNeed:50},
	{ID:"north_america", Title:"Северная Америка", Description:"Очень дорогой, но престижный рынок.", MinTier:6, Cost:800000000, BrandNeed:66},
	{ID:"latam", Title:"Латинская Америка", Description:"Растущий рынок с собственной динамикой.", MinTier:6, Cost:420000000, BrandNeed:62},
	{ID:"africa", Title:"Африка", Description:"Долгосрочное присутствие и новые возможности.", MinTier:6, Cost:360000000, BrandNeed:60},
}

var lifeProductOptions = []LifeProductOption{
	{ID:"consulting", Title:"Экспертная услуга", Description:"Простой первый продукт для небольшой компании.", MinTier:1, LaunchCost:30000, BuildSeconds:300, BaseRevenue:25000},
	{ID:"subscription", Title:"Подписочный сервис", Description:"Повторяющаяся выручка и требования к качеству.", MinTier:2, LaunchCost:250000, BuildSeconds:900, BaseRevenue:220000, InnovationNeed:8},
	{ID:"b2b", Title:"B2B-решение", Description:"Крупнее чеки и длиннее продажи.", MinTier:2, LaunchCost:400000, BuildSeconds:1200, BaseRevenue:360000, InnovationNeed:10},
	{ID:"consumer", Title:"Массовый продукт", Description:"Большой рынок, дорогое продвижение.", MinTier:3, LaunchCost:2500000, BuildSeconds:2400, BaseRevenue:2200000, InnovationNeed:18},
	{ID:"platform", Title:"Платформа", Description:"Сложный продукт, который масштабирует экосистему.", MinTier:4, LaunchCost:22000000, BuildSeconds:7200, BaseRevenue:18000000, InnovationNeed:32},
	{ID:"enterprise", Title:"Enterprise-линейка", Description:"Дорогие корпоративные контракты.", MinTier:4, LaunchCost:30000000, BuildSeconds:9000, BaseRevenue:26000000, InnovationNeed:28},
	{ID:"infrastructure", Title:"Инфраструктурный продукт", Description:"Очень дорогой запуск, зато сильный защитный барьер.", MinTier:5, LaunchCost:220000000, BuildSeconds:18000, BaseRevenue:180000000, InnovationNeed:48},
	{ID:"research", Title:"Исследовательское направление", Description:"Рискованный R&D с потенциально огромной отдачей.", MinTier:6, LaunchCost:1200000000, BuildSeconds:43200, BaseRevenue:900000000, InnovationNeed:70},
}

func lifeExpansionCatalog() LifeExpansionCatalog {
	careers := append([]LifeCareerOption(nil), lifeCareerOptions...)
	for i := range careers {
		careers[i].MinLevel = lifeCareerRequiredLevel(careers[i])
	}
	return LifeExpansionCatalog{
		Careers: careers,
		Assets: lifeAssetOptions,
		Investments: lifeInvestmentOptions,
		Hobbies: lifeHobbyOptions,
		Certifications: lifeCertificationOptions,
		Social: lifeSocialOptions,
		Industries: lifeBusinessIndustries,
		Departments: lifeDepartmentOptions,
		Regions: lifeRegionOptions,
		Products: lifeProductOptions,
	}
}

func lifeCareerRequiredLevel(role LifeCareerOption) int {
	switch {
	case role.Salary < 60_000:
		return 8
	case role.Salary < 100_000:
		return 15
	case role.Salary < 180_000:
		return 24
	case role.Salary < 300_000:
		return 34
	case role.Salary < 500_000:
		return 44
	case role.Salary < 800_000:
		return 54
	default:
		return 65
	}
}

func findLifeCareer(id string) (LifeCareerOption, bool) {
	for _, value := range lifeCareerOptions {
		if value.ID != id { continue }
		value.MinLevel = lifeCareerRequiredLevel(value)
		return value, true
	}
	return LifeCareerOption{}, false
}

func findLifeAsset(id string) (LifeAssetOption, bool) {
	for _, value := range lifeAssetOptions { if value.ID == id { return value, true } }
	return LifeAssetOption{}, false
}

func findLifeInvestment(id string) (LifeInvestmentOption, bool) {
	for _, value := range lifeInvestmentOptions { if value.ID == id { return value, true } }
	return LifeInvestmentOption{}, false
}

func findLifeHobby(id string) (LifeHobbyOption, bool) {
	for _, value := range lifeHobbyOptions { if value.ID == id { return value, true } }
	return LifeHobbyOption{}, false
}

func findLifeCertification(id string) (LifeCertificationOption, bool) {
	for _, value := range lifeCertificationOptions { if value.ID == id { return value, true } }
	return LifeCertificationOption{}, false
}

func findLifeSocial(id string) (LifeSocialOption, bool) {
	for _, value := range lifeSocialOptions { if value.ID == id { return value, true } }
	return LifeSocialOption{}, false
}

func findLifeIndustry(id string) (LifeBusinessIndustryOption, bool) {
	for _, value := range lifeBusinessIndustries { if value.ID == id { return value, true } }
	return LifeBusinessIndustryOption{}, false
}

func findLifeDepartment(id string) (LifeDepartmentOption, bool) {
	for _, value := range lifeDepartmentOptions { if value.ID == id { return value, true } }
	return LifeDepartmentOption{}, false
}

func findLifeRegion(id string) (LifeRegionOption, bool) {
	for _, value := range lifeRegionOptions { if value.ID == id { return value, true } }
	return LifeRegionOption{}, false
}

func findLifeProduct(id string) (LifeProductOption, bool) {
	for _, value := range lifeProductOptions { if value.ID == id { return value, true } }
	return LifeProductOption{}, false
}
