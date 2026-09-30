package games

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"
)

var ErrLifeBusy = errors.New("life activity is already running")
var ErrLifeLocked = errors.New("life option is locked")
var ErrLifeFunds = errors.New("not enough life cash")
var ErrLifeNeeds = errors.New("life needs are too low")
var ErrLifeEvent = errors.New("life event requires a choice")
var ErrLifeCooldown = errors.New("life action is on cooldown")

type LifeCompanyState struct {
	Tier          int                       `json:"tier"`
	Staff         int                       `json:"staff"`
	Brand         int                       `json:"brand"`
	Cash          int64                     `json:"cash"`
	DividendReady bool                      `json:"dividend_ready"`
	LastProfit    int64                     `json:"last_profit"`
	Industry      string                    `json:"industry"`
	MarketShare   int                       `json:"market_share"`
	Innovation    int                       `json:"innovation"`
	Debt          int64                     `json:"debt"`
	Valuation     int64                     `json:"valuation"`
	Public        bool                      `json:"public"`
	Ownership     int                       `json:"ownership"`
	Departments   map[string]int            `json:"departments"`
	Regions       []string                  `json:"regions"`
	Products      []LifeCompanyProductState `json:"products"`
	Acquisitions  int                       `json:"acquisitions"`
}

type LifeActivity struct {
	Kind           string     `json:"kind"`
	Target         string     `json:"target"`
	Title          string     `json:"title"`
	StartedAt      time.Time  `json:"started_at"`
	EndsAt         time.Time  `json:"ends_at"`
	GameDays       int        `json:"game_days"`
	CashReward     int64      `json:"cash_reward,omitempty"`
	HungerCost     int        `json:"hunger_cost,omitempty"`
	EnergyCost     int        `json:"energy_cost,omitempty"`
	ExperienceGain int        `json:"experience_gain,omitempty"`
	SkillGain      LifeSkills `json:"skill_gain,omitempty"`
	EducationLevel int        `json:"education_level,omitempty"`
	TargetLevel    int        `json:"target_level,omitempty"`
}

type LifeEventOption struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Hint  string `json:"hint"`
}

type LifePendingEvent struct {
	ID       string            `json:"id"`
	Kind     string            `json:"kind,omitempty"`
	StoryID  string            `json:"story_id,omitempty"`
	Title    string            `json:"title"`
	Text     string            `json:"text"`
	Severity string            `json:"severity"`
	Options  []LifeEventOption `json:"options"`
}

type LifeHistoryItem struct {
	At    time.Time `json:"at"`
	Kind  string    `json:"kind"`
	Title string    `json:"title"`
	Text  string    `json:"text"`
}

type LifeState struct {
	Version      int               `json:"version"`
	Cash         int64             `json:"cash"`
	Debt         int64             `json:"debt"`
	Hunger       int               `json:"hunger"`
	Energy       int               `json:"energy"`
	Health       int               `json:"health"`
	Mood         int               `json:"mood"`
	Education    int               `json:"education"`
	Experience   int               `json:"experience"`
	Reputation   int               `json:"reputation"`
	Days         int               `json:"days"`
	Home         int               `json:"home"`
	MaxHome      int               `json:"max_home,omitempty"`
	Skills       LifeSkills            `json:"skills"`
	Progression  LifeProgressionState  `json:"progression"`
	Story        LifeStoryState        `json:"story"`
	Career       *LifeCareerState      `json:"career,omitempty"`
	Finance      LifeFinanceState      `json:"finance"`
	Lifestyle    LifeLifestyleState  `json:"lifestyle"`
	Network      LifeNetworkState    `json:"network"`
	Economy      LifeEconomyState    `json:"economy"`
	Company      *LifeCompanyState   `json:"company,omitempty"`
	Active       *LifeActivity     `json:"active,omitempty"`
	Projects     []LifeActivity    `json:"projects,omitempty"`
	PendingEvent *LifePendingEvent `json:"pending_event,omitempty"`
	History      []LifeHistoryItem `json:"history"`
	RecentKeys   []string          `json:"recent_keys,omitempty"`
	LastTick     time.Time         `json:"last_tick"`
	LastFreeMeal time.Time         `json:"last_free_meal,omitempty"`
	LastEventDay int               `json:"last_event_day,omitempty"`
	TotalEarned  int64             `json:"total_earned"`
}

type LifeView struct {
	ServerNow  time.Time       `json:"server_now"`
	State      LifeState       `json:"state"`
	Catalog    LifeCatalog     `json:"catalog"`
	Milestones []LifeMilestone `json:"milestones"`
	Level      LifeLevelView   `json:"level"`
	Story      LifeStoryView   `json:"story"`
}

type lifeEventEffect struct {
	CashPercent        int
	CashFlat           int64
	CompanyCashPercent int
	CompanyCashFlat    int64
	Health             int
	Mood               int
	Reputation         int
	Brand              int
	Stress             int
	Fitness            int
	Staff              int
	MarketShare        int
	Innovation         int
	CareerPerformance  int
	CareerStability    int
	Friends            int
	Contacts           int
	Mentors            int
	FamilyBond         int
	Relationship       int
	CreditScore        int
	Skills             LifeSkills
}

type lifeEventChoiceDef struct {
	ID     string
	Title  string
	Hint   string
	Effect lifeEventEffect
}

type lifeEventDef struct {
	ID             string
	Title          string
	Text           string
	Severity       string
	NeedsCompany   bool
	NeedsCareer    bool
	NeedsTransport bool
	MinCompanyTier int
	MinEducation   int
	MinExperience  int
	MinStress      int
	MinHome        int
	MinFriends     int
	MinContacts    int
	MinCash        int64
	StartEffect    lifeEventEffect
	Choices        []lifeEventChoiceDef
}

var lifeEventDefs = []lifeEventDef{
	{ID:"theft", Title:"Кража в городе", Text:"В толпе у вас пропали деньги и часть вещей. Неприятный день, который выбивает из ритма.", Severity:"danger", MinCash:2500, Choices:[]lifeEventChoiceDef{
		{ID:"report", Title:"Заявить о краже", Hint:"Потеряете часть денег, но быстрее вернётесь в ритм.", Effect:lifeEventEffect{CashPercent:-10,Mood:-5,Reputation:1}},
		{ID:"accept", Title:"Смириться и идти дальше", Hint:"Потери чуть меньше, удар по настроению сильнее.", Effect:lifeEventEffect{CashPercent:-8,Mood:-9}},
	}},
	{ID:"illness", Title:"Вы заболели", Text:"Слишком плотный график дал о себе знать. Теперь нужно решить, как восстанавливаться.", Severity:"danger", StartEffect:lifeEventEffect{Health:-10,Mood:-3}, Choices:[]lifeEventChoiceDef{
		{ID:"doctor", Title:"Обратиться к врачу", Hint:"Дороже, зато здоровье восстанавливается быстрее.", Effect:lifeEventEffect{CashFlat:-4000,Health:9,Mood:1}},
		{ID:"rest", Title:"Отлежаться дома", Hint:"Без крупных расходов, но эффект слабее.", Effect:lifeEventEffect{Health:4,Mood:-2}},
	}},
	{ID:"bonus", Title:"Неожиданная премия", Text:"Ваш результат заметили и отдельно отметили.", Severity:"good", Choices:[]lifeEventChoiceDef{
		{ID:"take", Title:"Принять премию", Hint:"Деньги, настроение и немного репутации.", Effect:lifeEventEffect{CashFlat:6500,Reputation:2,Mood:4}},
	}},
	{ID:"mentor", Title:"Предложение наставника", Text:"Опытный руководитель готов разбирать ваши решения и ошибки.", Severity:"good", MinEducation:1, Choices:[]lifeEventChoiceDef{
		{ID:"join", Title:"Согласиться", Hint:"Платно, но ускоряет управленческий рост.", Effect:lifeEventEffect{CashFlat:-15000,Reputation:2,Mentors:1,Contacts:2,Skills:LifeSkills{Management:4,Communication:2}}},
		{ID:"later", Title:"Отказаться сейчас", Hint:"Без расходов и без бонуса.", Effect:lifeEventEffect{Mood:1}},
	}},
	{ID:"market", Title:"Рынок просел", Text:"Спрос снизился, часть контрактов перенесли. Компания теряет деньги.", Severity:"danger", NeedsCompany:true, Choices:[]lifeEventChoiceDef{
		{ID:"stabilize", Title:"Стабилизировать компанию", Hint:"Потери выше, бренд почти не пострадает.", Effect:lifeEventEffect{CompanyCashPercent:-7,Brand:-1}},
		{ID:"cut", Title:"Резко сократить расходы", Hint:"Потери меньше, но бренд и репутация пострадают.", Effect:lifeEventEffect{CompanyCashPercent:-3,Brand:-4,Reputation:-1}},
	}},
	{ID:"client", Title:"Крупный клиент", Text:"На компанию вышел клиент, который раньше был слишком большим для вашего масштаба.", Severity:"good", NeedsCompany:true, Choices:[]lifeEventChoiceDef{
		{ID:"take", Title:"Взяться за контракт", Hint:"Рост капитала, бренда и репутации.", Effect:lifeEventEffect{CompanyCashPercent:8,Brand:3,Reputation:2}},
		{ID:"decline", Title:"Не рисковать качеством", Hint:"Без денег, зато бренд чуть укрепится.", Effect:lifeEventEffect{Brand:1,Reputation:1}},
	}},
	{ID:"failure", Title:"Публичная ошибка", Text:"Ваше решение оказалось неудачным. Теперь важнее реакция на ошибку, чем сама ошибка.", Severity:"warning", Choices:[]lifeEventChoiceDef{
		{ID:"own", Title:"Признать и исправить", Hint:"Неприятно, зато растёт доверие.", Effect:lifeEventEffect{Mood:-3,Reputation:2,Skills:LifeSkills{Discipline:1}}},
		{ID:"hide", Title:"Сделать вид, что ничего не было", Hint:"Легче сейчас, но репутация пострадает.", Effect:lifeEventEffect{Mood:1,Reputation:-3}},
	}},
	{ID:"equipment", Title:"Сломалась рабочая техника", Text:"Устройство, на котором вы работаете и учитесь, внезапно вышло из строя.", Severity:"warning", MinExperience:8, Choices:[]lifeEventChoiceDef{
		{ID:"replace", Title:"Нормально починить", Hint:"Дорого, зато без долгосрочного ущерба.", Effect:lifeEventEffect{CashFlat:-6000,Mood:-2}},
		{ID:"cheap", Title:"Сделать временный ремонт", Hint:"Дешевле, но работать станет чуть сложнее.", Effect:lifeEventEffect{CashFlat:-1500,Mood:-3,Skills:LifeSkills{Digital:-1}}},
	}},
	{ID:"lost_contract", Title:"Сорвался важный проект", Text:"Несколько недель подготовки не превратились в контракт. Нужно решить, как реагировать на неудачу.", Severity:"warning", MinExperience:20, Choices:[]lifeEventChoiceDef{
		{ID:"review", Title:"Разобрать ошибки", Hint:"Потратите деньги и время, зато сохраните лицо и получите опыт.", Effect:lifeEventEffect{CashFlat:-5000,Mood:-2,Reputation:1,Skills:LifeSkills{Communication:1,Discipline:1}}},
		{ID:"move_on", Title:"Закрыть тему", Hint:"Дешевле сейчас, но неприятный след останется.", Effect:lifeEventEffect{Mood:-5,Reputation:-1}},
	}},
	{ID:"internal_fraud", Title:"Проблема внутри компании", Text:"Финансовая проверка обнаружила подозрительные расходы одного из подразделений.", Severity:"danger", NeedsCompany:true, Choices:[]lifeEventChoiceDef{
		{ID:"audit", Title:"Провести полный аудит", Hint:"Дороже, но прозрачность укрепит доверие.", Effect:lifeEventEffect{CompanyCashPercent:-6,Brand:-1,Reputation:2,Skills:LifeSkills{Finance:1}}},
		{ID:"quiet", Title:"Решить тихо", Hint:"Меньше прямых потерь, но репутационный риск выше.", Effect:lifeEventEffect{CompanyCashPercent:-3,Brand:-3,Reputation:-2}},
	}},
	{ID:"supply_shock", Title:"Сбой поставок", Text:"Ключевой подрядчик сорвал сроки. Клиенты уже ждут результат.", Severity:"danger", NeedsCompany:true, Choices:[]lifeEventChoiceDef{
		{ID:"expedite", Title:"Заплатить за срочную замену", Hint:"Сильно бьёт по кассе, зато бренд почти не страдает.", Effect:lifeEventEffect{CompanyCashPercent:-8,Brand:-1}},
		{ID:"delay", Title:"Перенести сроки", Hint:"Денег потеряете меньше, но клиенты запомнят задержку.", Effect:lifeEventEffect{CompanyCashPercent:-3,Brand:-4,Reputation:-1}},
	}},
	{ID:"viral_launch", Title:"Продукт неожиданно выстрелил", Text:"Запуск получил намного больше внимания, чем планировалось. Спрос и узнаваемость резко выросли.", Severity:"good", NeedsCompany:true, Choices:[]lifeEventChoiceDef{
		{ID:"scale", Title:"Использовать момент", Hint:"Рост капитала и бренда, но команда получает больше нагрузки.", Effect:lifeEventEffect{CompanyCashPercent:12,Brand:4,Reputation:2,Mood:3,Stress:5}},
	}},
	{ID:"rent_jump", Title:"Расходы на жильё выросли", Text:"Быт внезапно стал дороже. Нужно либо принять новые расходы, либо урезать привычный комфорт.", Severity:"warning", MinExperience:5, Choices:[]lifeEventChoiceDef{
		{ID:"pay", Title:"Сохранить привычный уровень", Hint:"Дороже, но без удара по настроению.", Effect:lifeEventEffect{CashFlat:-4500}},
		{ID:"cut", Title:"Сильно экономить", Hint:"Меньше прямых расходов, хуже настроение.", Effect:lifeEventEffect{CashFlat:-1200,Mood:-5,Stress:4}},
	}},
	{ID:"burnout", Title:"Признаки выгорания", Text:"Организм и голова перестали успевать за вашим темпом. Ещё немного — и продуктивность начнёт рушиться.", Severity:"danger", MinStress:72, StartEffect:lifeEventEffect{Mood:-6,Health:-4,CareerPerformance:-4}, Choices:[]lifeEventChoiceDef{
		{ID:"vacation", Title:"Сделать паузу", Hint:"Потратить деньги и резко снизить стресс.", Effect:lifeEventEffect{CashFlat:-18000,Stress:-25,Mood:10,Health:5}},
		{ID:"push", Title:"Дожать через силу", Hint:"Сэкономить деньги, но рискнуть здоровьем.", Effect:lifeEventEffect{Stress:12,Health:-8,Mood:-6,Reputation:1}},
	}},
	{ID:"tax_refund", Title:"Возврат переплаты", Text:"После пересчёта вам вернули часть ранее уплаченных игровых налогов.", Severity:"good", MinExperience:20, Choices:[]lifeEventChoiceDef{
		{ID:"take", Title:"Получить возврат", Hint:"Небольшой приятный денежный бонус.", Effect:lifeEventEffect{CashFlat:12000,Mood:3}},
	}},
	{ID:"friend_support", Title:"Друг помог в сложный момент", Text:"Близкий человек заметил, что вы перегружены, и вытянул вас на спокойный вечер.", Severity:"good", MinFriends:1, Choices:[]lifeEventChoiceDef{
		{ID:"accept", Title:"Отключиться от работы", Hint:"Снижение стресса и восстановление настроения.", Effect:lifeEventEffect{Stress:-12,Mood:8,Friends:1}},
	}},
	{ID:"conference_invite", Title:"Приглашение на профессиональную конференцию", Text:"Вас заметили в профессиональной среде и пригласили выступить или поучаствовать в закрытой встрече.", Severity:"good", MinExperience:28, MinEducation:1, MinContacts:5, Choices:[]lifeEventChoiceDef{
		{ID:"go", Title:"Поехать", Hint:"Стоит денег, зато растит репутацию и навыки.", Effect:lifeEventEffect{CashFlat:-15000,Reputation:4,Mood:4,Contacts:5,CareerStability:2,Skills:LifeSkills{Communication:2,Management:1}}},
		{ID:"skip", Title:"Не тратить время", Hint:"Никаких затрат, но возможность уйдёт.", Effect:lifeEventEffect{}},
	}},
	{ID:"car_repair", Title:"Транспорт потребовал ремонта", Text:"Мобильность оказалась не бесплатной: появилась внезапная техническая проблема.", Severity:"warning", NeedsTransport:true, MinCash:5000, Choices:[]lifeEventChoiceDef{
		{ID:"proper", Title:"Починить нормально", Hint:"Дороже, но без долгого раздражения.", Effect:lifeEventEffect{CashFlat:-22000,Mood:-1}},
		{ID:"temporary", Title:"Сделать временно", Hint:"Дешевле, но добавляет стресса.", Effect:lifeEventEffect{CashFlat:-7000,Stress:5,Mood:-3}},
	}},
	{ID:"checkup", Title:"Плановый медосмотр", Text:"Есть шанс вложиться в профилактику вместо того, чтобы потом лечить проблему в кризисе.", Severity:"good", MinExperience:10, Choices:[]lifeEventChoiceDef{
		{ID:"full", Title:"Пройти обследование", Hint:"Стоит денег, но укрепляет здоровье.", Effect:lifeEventEffect{CashFlat:-9000,Health:7,Stress:-3}},
		{ID:"later", Title:"Отложить", Hint:"Без расходов прямо сейчас.", Effect:lifeEventEffect{}},
	}},
	{ID:"data_loss", Title:"Потеря рабочих файлов", Text:"Часть личных рабочих материалов пропала после технического сбоя.", Severity:"warning", MinExperience:12, Choices:[]lifeEventChoiceDef{
		{ID:"restore", Title:"Оплатить восстановление", Hint:"Дороже, зато ущерб минимален.", Effect:lifeEventEffect{CashFlat:-11000,Stress:3}},
		{ID:"redo", Title:"Переделать вручную", Hint:"Дешевле, но болезненнее по времени и нервам.", Effect:lifeEventEffect{Stress:9,Mood:-4,Skills:LifeSkills{Discipline:1}}},
	}},
	{ID:"restructure", Title:"Реструктуризация у работодателя", Text:"Компания меняет команды и бюджеты. Ваша позиция тоже попала в зону неопределённости.", Severity:"warning", NeedsCareer:true, Choices:[]lifeEventChoiceDef{
		{ID:"visible", Title:"Сделать результат заметнее", Hint:"Стресс выше, но позиция становится устойчивее.", Effect:lifeEventEffect{Stress:6,Reputation:2,CareerPerformance:4,CareerStability:7,Skills:LifeSkills{Communication:1}}},
		{ID:"quiet", Title:"Переждать", Hint:"Меньше напряжения, но риск позиции выше.", Effect:lifeEventEffect{Mood:-2,CareerStability:-8}},
	}},
	{ID:"side_project", Title:"Удачный побочный проект", Text:"Небольшая идея неожиданно принесла деньги и полезный опыт.", Severity:"good", MinExperience:15, Choices:[]lifeEventChoiceDef{
		{ID:"ship", Title:"Довести до результата", Hint:"Доход, digital-опыт и немного стресса.", Effect:lifeEventEffect{CashFlat:18000,Stress:3,Mood:5,Skills:LifeSkills{Digital:2,Discipline:1}}},
	}},
	{ID:"home_repair", Title:"Дом потребовал вложений", Text:"Даже собственное жильё иногда внезапно превращается в статью расходов.", Severity:"warning", MinExperience:18, MinHome:1, Choices:[]lifeEventChoiceDef{
		{ID:"fix", Title:"Сделать качественно", Hint:"Дороже, зато спокойнее.", Effect:lifeEventEffect{CashFlat:-30000,Mood:1}},
		{ID:"cheap", Title:"Сэкономить", Hint:"Меньше расходов, больше раздражения.", Effect:lifeEventEffect{CashFlat:-9000,Mood:-4,Stress:4}},
	}},
	{ID:"market_panic", Title:"Рыночная паника", Text:"Новости испугали инвесторов. Главное решение сейчас — не сама просадка, а ваша реакция.", Severity:"warning", MinExperience:25, Choices:[]lifeEventChoiceDef{
		{ID:"calm", Title:"Не принимать решений в панике", Hint:"Стресс растёт меньше, финансовый навык укрепляется.", Effect:lifeEventEffect{Stress:2,Skills:LifeSkills{Finance:1}}},
		{ID:"panic", Title:"Срочно искать выход", Hint:"Эмоционально тяжёлое решение.", Effect:lifeEventEffect{Stress:8,Mood:-5}},
	}},
	{ID:"key_employee", Title:"Ключевой сотрудник уходит", Text:"Сильный человек принял предложение конкурента. Это удар по команде и темпу.", Severity:"danger", NeedsCompany:true, MinCompanyTier:2, Choices:[]lifeEventChoiceDef{
		{ID:"counter", Title:"Удержать деньгами", Hint:"Дорого, но команда сохраняется.", Effect:lifeEventEffect{CompanyCashFlat:-120000,Brand:1}},
		{ID:"replace", Title:"Искать замену", Hint:"Команда уменьшается и появляется операционный риск.", Effect:lifeEventEffect{Staff:-1,Stress:4,Brand:-1}},
	}},
	{ID:"regulator_audit", Title:"Регуляторная проверка", Text:"Компания получила запрос документов и процессов. Слабые контрольные функции могут сделать это дорогим.", Severity:"danger", NeedsCompany:true, MinCompanyTier:3, Choices:[]lifeEventChoiceDef{
		{ID:"transparent", Title:"Открыто пройти проверку", Hint:"Расходы выше, репутационный риск ниже.", Effect:lifeEventEffect{CompanyCashPercent:-4,Reputation:2}},
		{ID:"minimum", Title:"Дать только необходимое", Hint:"Дешевле, но бренд может пострадать.", Effect:lifeEventEffect{CompanyCashPercent:-2,Brand:-3}},
	}},
	{ID:"cyber", Title:"Киберинцидент", Text:"Часть внутренних систем оказалась недоступна. Скорость реакции определит размер ущерба.", Severity:"danger", NeedsCompany:true, MinCompanyTier:3, Choices:[]lifeEventChoiceDef{
		{ID:"response", Title:"Запустить полноценное восстановление", Hint:"Дорого, но защищает доверие.", Effect:lifeEventEffect{CompanyCashPercent:-6,Brand:-1,Innovation:1}},
		{ID:"cheap", Title:"Латать по минимуму", Hint:"Экономия сейчас, больший удар по бренду.", Effect:lifeEventEffect{CompanyCashPercent:-2,Brand:-5,MarketShare:-1}},
	}},
	{ID:"price_war", Title:"Конкурент начал ценовую войну", Text:"Рынок резко стал дешевле. Можно защищать долю или сохранять маржу.", Severity:"warning", NeedsCompany:true, MinCompanyTier:3, Choices:[]lifeEventChoiceDef{
		{ID:"defend", Title:"Защищать долю рынка", Hint:"Дорого, но удерживает позиции.", Effect:lifeEventEffect{CompanyCashPercent:-7,MarketShare:2}},
		{ID:"margin", Title:"Сохранить цены", Hint:"Касса стабильнее, доля рынка снижается.", Effect:lifeEventEffect{CompanyCashPercent:-2,MarketShare:-3,Brand:-1}},
	}},
	{ID:"breakthrough", Title:"Технологический прорыв", Text:"Исследовательская команда нашла решение, которое заметно опережает прежний уровень продукта.", Severity:"good", NeedsCompany:true, MinCompanyTier:4, Choices:[]lifeEventChoiceDef{
		{ID:"invest", Title:"Ускорить внедрение", Hint:"Большие затраты, сильный рост инноваций.", Effect:lifeEventEffect{CompanyCashPercent:-8,Innovation:10,Brand:4}},
		{ID:"protect", Title:"Развивать осторожно", Hint:"Меньше затрат и умеренный технологический рост.", Effect:lifeEventEffect{CompanyCashPercent:-3,Innovation:5,Brand:2}},
	}},
	{ID:"export_contract", Title:"Международный контракт", Text:"Зарубежный партнёр готов подписать большой контракт, если компания возьмёт на себя дополнительные риски.", Severity:"good", NeedsCompany:true, MinCompanyTier:5, Choices:[]lifeEventChoiceDef{
		{ID:"take", Title:"Взять контракт", Hint:"Сильный рост выручки и бренда.", Effect:lifeEventEffect{CompanyCashPercent:9,Brand:4,MarketShare:2,Reputation:2}},
		{ID:"decline", Title:"Не перегружать бизнес", Hint:"Без денег, но сохраняется устойчивость.", Effect:lifeEventEffect{Reputation:1}},
	}},
	{ID:"recall", Title:"Отзыв продукта", Text:"В одном из продуктов обнаружена серьёзная проблема качества. Нужно решить, насколько открыто её исправлять.", Severity:"danger", NeedsCompany:true, MinCompanyTier:4, Choices:[]lifeEventChoiceDef{
		{ID:"full", Title:"Полный отзыв и компенсации", Hint:"Очень дорого, но доверие можно сохранить.", Effect:lifeEventEffect{CompanyCashPercent:-10,Brand:-2,Reputation:2}},
		{ID:"patch", Title:"Тихое исправление", Hint:"Дешевле, но риск для бренда выше.", Effect:lifeEventEffect{CompanyCashPercent:-4,Brand:-6,MarketShare:-2}},
	}},
	{ID:"office_crisis", Title:"Крупная авария в инфраструктуре", Text:"Часть операционной инфраструктуры временно недоступна.", Severity:"danger", NeedsCompany:true, MinCompanyTier:4, Choices:[]lifeEventChoiceDef{
		{ID:"restore", Title:"Быстро восстановить", Hint:"Высокие расходы, минимальный ущерб бренду.", Effect:lifeEventEffect{CompanyCashPercent:-7,Brand:-1}},
		{ID:"slow", Title:"Восстанавливать постепенно", Hint:"Дешевле, но бизнес теряет долю рынка.", Effect:lifeEventEffect{CompanyCashPercent:-3,MarketShare:-3,Brand:-3}},
	}},
}

func newLifeState(now time.Time) LifeState {
	return LifeState{
		Version: 3,
		Hunger: 28,
		Energy: 78,
		Health: 82,
		Mood: 55,
		Skills: LifeSkills{Discipline:10, Communication:8, Digital:5, Finance:4, Management:1},
		Network: LifeNetworkState{FamilyBond:50},
		LastTick: now,
		History: []LifeHistoryItem{{At:now, Kind:"start", Title:"18 лет. Первый день", Text:"0 ₽, еды нет, профессии нет. Начать можно с любой доступной подработки."}},
	}
}

func clampLife(v int) int {
	if v < 0 { return 0 }
	if v > 100 { return 100 }
	return v
}

func addLifeSkills(dst *LifeSkills, gain LifeSkills) {
	dst.Discipline = clampLife(dst.Discipline + gain.Discipline)
	dst.Communication = clampLife(dst.Communication + gain.Communication)
	dst.Digital = clampLife(dst.Digital + gain.Digital)
	dst.Finance = clampLife(dst.Finance + gain.Finance)
	dst.Management = clampLife(dst.Management + gain.Management)
}

func meetsLifeSkills(have, need LifeSkills) bool {
	return have.Discipline >= need.Discipline &&
		have.Communication >= need.Communication &&
		have.Digital >= need.Digital &&
		have.Finance >= need.Finance &&
		have.Management >= need.Management
}

func lifeHistory(st *LifeState, now time.Time, kind, title, text string) {
	st.History = append([]LifeHistoryItem{{At:now, Kind:kind, Title:title, Text:text}}, st.History...)
	if len(st.History) > 30 { st.History = st.History[:30] }
}

func (s *Service) loadLife(ctx context.Context, tx *sql.Tx, userID int64, now time.Time) (LifeState, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('life:' || $1::bigint::text,0))`, userID); err != nil {
		return LifeState{}, err
	}
	var data []byte
	err := tx.QueryRowContext(ctx, "SELECT state FROM game_life_profiles WHERE user_id=$1 FOR UPDATE", userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		st := newLifeState(now)
		normalizeLifeExpansion(&st)
		data, err = json.Marshal(st)
		if err != nil { return LifeState{}, err }
		_, err = tx.ExecContext(ctx, "INSERT INTO game_life_profiles(user_id,state,updated_at) VALUES($1,$2,$3)", userID, data, now)
		return st, err
	}
	if err != nil { return LifeState{}, err }
	var st LifeState
	if err = json.Unmarshal(data, &st); err != nil { return LifeState{}, err }
	if st.LastTick.IsZero() { st.LastTick = now }
	normalizeLifeExpansion(&st)
	return st, nil
}

func saveLife(ctx context.Context, tx *sql.Tx, userID int64, st LifeState, now time.Time) error {
	data, err := json.Marshal(st)
	if err != nil { return err }
	if _, err = tx.ExecContext(ctx, "UPDATE game_life_profiles SET state=$1, updated_at=$2 WHERE user_id=$3", data, now, userID); err != nil {
		return err
	}
	netWorth := lifeNetWorth(st)
	if netWorth < 0 { netWorth = 0 }
	return upsertHighScore(ctx, tx, userID, "life", netWorth, st.TotalEarned, now)
}

func lifeView(now time.Time, st LifeState) LifeView {
	return LifeView{
		ServerNow:now,
		State:st,
		Catalog:lifeCatalog(),
		Milestones:lifeMilestones(st),
		Level:lifeLevelView(st),
		Story:lifeStoryView(st),
	}
}

func (s *Service) Life(ctx context.Context, userID int64) (LifeView, error) {
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return LifeView{}, err }
	defer tx.Rollback()
	st, err := s.loadLife(ctx, tx, userID, now)
	if err != nil { return LifeView{}, err }
	s.settleLife(&st, now)
	lifeFinalizeState(&st, now, true)
	if err = saveLife(ctx, tx, userID, st, now); err != nil { return LifeView{}, err }
	if err = tx.Commit(); err != nil { return LifeView{}, err }
	return lifeView(now, st), nil
}

func (s *Service) LifeAction(ctx context.Context, userID int64, action, target, key string) (LifeView, error) {
	if len(key) < 8 || len(key) > 100 || len(action) < 2 || len(action) > 40 || len(target) > 80 {
		return LifeView{}, ErrInput
	}
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return LifeView{}, err }
	defer tx.Rollback()
	st, err := s.loadLife(ctx, tx, userID, now)
	if err != nil { return LifeView{}, err }
	s.settleLife(&st, now)

	for _, old := range st.RecentKeys {
		if old == key {
			lifeFinalizeState(&st, now, true)
			if err = saveLife(ctx, tx, userID, st, now); err != nil { return LifeView{}, err }
			if err = tx.Commit(); err != nil { return LifeView{}, err }
			return lifeView(now, st), nil
		}
	}
	if st.PendingEvent != nil && action != "resolve_event" {
		return LifeView{}, ErrLifeEvent
	}

	switch action {
	case "start_job":
		err = s.lifeStartJob(&st, target, now)
	case "start_study":
		err = s.lifeStartStudy(&st, target, now)
	case "train":
		err = s.lifeStartTraining(&st, target, now)
	case "rest":
		err = s.lifeStartRest(&st, now)
	case "eat":
		err = s.lifeEat(&st, target, now)
	case "buy_home":
		err = s.lifeBuyHome(&st, target, now)
	case "home_select":
		err = s.lifeHomeSelect(&st, target)
	case "start_business":
		err = s.lifeStartBusiness(&st, now)
	case "business_cycle":
		err = s.lifeStartBusinessCycle(&st, target, now)
	case "business_hire":
		err = s.lifeBusinessHire(&st, target, now)
	case "business_invest":
		err = s.lifeBusinessInvest(&st, target, now)
	case "business_expand":
		err = s.lifeBusinessExpand(&st, now)
	case "business_dividend":
		err = s.lifeBusinessDividend(&st, now)
	case "career_apply":
		err = s.lifeCareerApply(&st, target, now)
	case "career_work":
		err = s.lifeCareerWork(&st, now)
	case "career_quit":
		err = s.lifeCareerQuit(&st, now)
	case "asset_buy":
		err = s.lifeAssetBuy(&st, target, now)
	case "wardrobe_equip":
		err = s.lifeWardrobeEquip(&st, target)
	case "hobby":
		err = s.lifeHobbyStart(&st, target, now)
	case "certification":
		err = s.lifeCertificationStart(&st, target, now)
	case "social":
		err = s.lifeSocialStart(&st, target, now)
	case "finance_save":
		err = s.lifeFinanceSave(&st, target, now)
	case "finance_withdraw":
		err = s.lifeFinanceWithdraw(&st, target, now)
	case "finance_invest":
		err = s.lifeFinanceInvest(&st, target, now)
	case "finance_sell":
		err = s.lifeFinanceSell(&st, target, now)
	case "finance_loan":
		err = s.lifeFinanceLoan(&st, target, now)
	case "insurance_buy":
		err = s.lifeInsuranceBuy(&st, target, now)
	case "business_industry":
		err = s.lifeBusinessSetIndustry(&st, target, now)
	case "business_department":
		err = s.lifeBusinessDepartment(&st, target, now)
	case "business_product":
		err = s.lifeBusinessLaunchProduct(&st, target, now)
	case "business_region":
		err = s.lifeBusinessRegion(&st, target, now)
	case "business_loan":
		err = s.lifeBusinessLoan(&st, target, now)
	case "business_repay_loan":
		err = s.lifeBusinessRepayLoan(&st, target, now)
	case "business_acquire":
		err = s.lifeBusinessAcquire(&st, now)
	case "business_ipo":
		err = s.lifeBusinessIPO(&st, now)
	case "repay_debt":
		err = s.lifeRepayDebt(&st, now)
	case "resolve_event":
		err = s.lifeResolveEvent(&st, target, now)
	default:
		err = ErrInput
	}
	if err != nil { return LifeView{}, err }

	// Foreground actions are resolved immediately in game time. Long projects live
	// in st.Projects and never block the rest of the simulator.
	s.settleLife(&st, now)

	st.RecentKeys = append([]string{key}, st.RecentKeys...)
	if len(st.RecentKeys) > 32 { st.RecentKeys = st.RecentKeys[:32] }
	lifeFinalizeState(&st, now, action != "resolve_event")
	if err = saveLife(ctx, tx, userID, st, now); err != nil { return LifeView{}, err }
	if err = tx.Commit(); err != nil { return LifeView{}, err }
	return lifeView(now, st), nil
}

func (s *Service) settleLife(st *LifeState, now time.Time) {
	// Wall-clock time no longer drains hunger/energy. The player progresses by
	// decisions, not by being punished for closing the Mini App.
	if st.LastTick.After(now) || st.LastTick.IsZero() {
		st.LastTick = now
	}
	st.LastTick = now

	completed := false

	// Migration path for old saves: any legacy blocking activity is completed on
	// the next request instead of forcing the player to wait out the old timer.
	if st.Active != nil {
		active := *st.Active
		st.Active = nil
		s.finishLifeActivity(st, active, now)
		completed = true
	}

	if len(st.Projects) > 0 {
		pending := make([]LifeActivity, 0, len(st.Projects))
		for _, project := range st.Projects {
			if now.Before(project.EndsAt) {
				pending = append(pending, project)
				continue
			}
			s.finishLifeActivity(st, project, now)
			completed = true
		}
		st.Projects = pending
	}

	if !completed { return }
	lifeSyncMilestoneXP(st)
	if st.PendingEvent == nil && maybeLifeStory(st, now) {
		return
	}
	if st.PendingEvent == nil && st.Days-st.LastEventDay >= 7 && random(100) < 19 {
		if s.maybeLifeEvent(st) {
			st.LastEventDay = st.Days
		}
	}
}

func (s *Service) finishLifeActivity(st *LifeState, a LifeActivity, now time.Time) {
	background := isLifeBackgroundProject(a.Kind)
	calendarDays := a.GameDays
	if background {
		// A background project overlaps the rest of the character's life. Its
		// catalog duration expresses scope/reward, not additional calendar time;
		// otherwise a degree running alongside work would age the hero twice.
		calendarDays = 0
	} else {
		accelerateLifeProjects(st, a.GameDays)
	}
	st.Days += calendarDays
	st.Hunger = clampLife(st.Hunger - a.HungerCost)
	st.Energy = clampLife(st.Energy - a.EnergyCost)
	addLifeSkills(&st.Skills, a.SkillGain)
	advanceLifeExpansion(st, calendarDays, now)
	switch a.Kind {
	case "job":
		st.Cash += a.CashReward
		st.TotalEarned += a.CashReward
		st.Experience += a.ExperienceGain
		if st.Experience > 0 && st.Experience%10 == 0 { st.Reputation++ }
		lifeHistory(st, now, "work", a.Title+" завершена", fmt.Sprintf("+%d ₽ · опыт +%d", a.CashReward, a.ExperienceGain))
	case "study":
		if a.EducationLevel > st.Education { st.Education = a.EducationLevel }
		st.Reputation += 2
		lifeHistory(st, now, "study", a.Title+" завершено", "Новая ступень образования открыла часть карьерных возможностей.")
	case "train":
		lifeHistory(st, now, "growth", a.Title+" завершено", "Навыки выросли. Новые вакансии и бизнес-ступени становятся ближе.")
	case "rest":
		bonus := 0
		for _, h := range lifeHomes { if h.Level == st.Home { bonus = h.RestBonus } }
		assetEnergy, assetMood, _, _ := lifeAssetBonuses(st)
		st.Energy = clampLife(st.Energy + 62 + bonus + assetEnergy)
		st.Health = clampLife(st.Health + 4 + st.Lifestyle.Fitness/25)
		st.Mood = clampLife(st.Mood + 4 + assetMood)
		st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress - 8)
		lifeHistory(st, now, "life", "Вы выспались", "Энергия, здоровье и стресс восстановлены с учётом качества быта.")
	case "business_cycle":
		s.finishBusinessCycle(st, a.Target, now)
	case "business_expand":
		if st.Company != nil {
			st.Company.Tier = a.TargetLevel
			st.Company.Brand = clampLife(st.Company.Brand + 4)
			st.Company.Valuation = max(st.Company.Valuation, st.Company.Cash*4)
			st.Reputation += 4
			if tier, ok := findLifeBusinessTier(a.TargetLevel); ok {
				lifeHistory(st, now, "business", "Масштабирование завершено", "Компания стала: "+tier.Title+".")
			}
		}
	default:
		finishLifeExpansionActivity(s, st, a, now)
	}
	st.Health = clampLife(st.Health)
	st.Mood = clampLife(st.Mood)
	st.Reputation = clampLife(st.Reputation)
	lifeAwardActivityXP(st, a)
	lifeSyncMilestoneXP(st)
}

func isLifeBackgroundProject(kind string) bool {
	switch kind {
	case "study", "certification", "business_expand", "business_product", "business_region":
		return true
	default:
		return false
	}
}

func lifeBackgroundDuration(duration time.Duration) time.Duration {
	switch {
	case duration <= 10*time.Minute:
		return 2 * time.Minute
	case duration <= time.Hour:
		return 3 * time.Minute
	case duration <= 4*time.Hour:
		return 5 * time.Minute
	case duration <= 12*time.Hour:
		return 8 * time.Minute
	case duration <= 24*time.Hour:
		return 10 * time.Minute
	default:
		return 12 * time.Minute
	}
}

func accelerateLifeProjects(st *LifeState, gameDays int) {
	if gameDays <= 0 || len(st.Projects) == 0 { return }
	seconds := min(300, max(1, gameDays)*20)
	boost := time.Duration(seconds) * time.Second
	for i := range st.Projects {
		st.Projects[i].EndsAt = st.Projects[i].EndsAt.Add(-boost)
	}
}

func checkLifeProjectSlot(st *LifeState, kind, target string) error {
	for _, project := range st.Projects {
		if project.Kind == kind && project.Target == target {
			return ErrLifeBusy
		}
	}
	if len(st.Projects) >= 3 { return ErrLifeBusy }
	return nil
}

func startLifeProject(st *LifeState, now time.Time, duration time.Duration, a LifeActivity) error {
	if err := checkLifeProjectSlot(st, a.Kind, a.Target); err != nil { return err }
	a.StartedAt = now
	a.EndsAt = now.Add(lifeBackgroundDuration(duration))
	st.Projects = append(st.Projects, a)
	lifeHistory(st, now, "progress", a.Title+" начато", "Проект идёт в фоне. Можно продолжать работать, отдыхать, общаться и заниматься другими делами.")
	return nil
}

func startLifeActivity(st *LifeState, now time.Time, duration time.Duration, a LifeActivity) error {
	if st.Active != nil { return ErrLifeBusy }
	_ = duration
	a.StartedAt = now
	a.EndsAt = now
	st.Active = &a
	return nil
}

func (s *Service) lifeStartJob(st *LifeState, id string, now time.Time) error {
	job, ok := findLifeJob(id)
	if !ok { return ErrInput }
	if st.Education < job.MinEducation || st.Experience < job.MinExperience || st.Reputation < job.MinReputation || !meetsLifeSkills(st.Skills, job.MinSkills) { return ErrLifeLocked }
	if st.Hunger < 12 || st.Energy < job.EnergyCost+5 || st.Health < 20 { return ErrLifeNeeds }
	return startLifeActivity(st, now, time.Duration(job.DurationSeconds)*time.Second, LifeActivity{
		Kind:"job", Target:id, Title:job.Title, GameDays:job.GameDays, CashReward:job.Pay,
		HungerCost:job.HungerCost, EnergyCost:job.EnergyCost, ExperienceGain:job.ExperienceGain, SkillGain:job.SkillGain,
	})
}

func (s *Service) lifeStartStudy(st *LifeState, id string, now time.Time) error {
	p, ok := findLifeProgram(id)
	if !ok { return ErrInput }
	if st.Education != p.MinEducation || p.Level != st.Education+1 || st.Experience < p.MinExperience || !meetsLifeSkills(st.Skills, p.MinSkills) { return ErrLifeLocked }
	if st.Cash < p.Cost { return ErrLifeFunds }
	if st.Hunger < 18 || st.Energy < 25 || st.Health < 25 { return ErrLifeNeeds }
	if err := checkLifeProjectSlot(st, "study", id); err != nil { return err }
	st.Cash -= p.Cost
	studyDuration := time.Duration(p.DurationSeconds) * time.Second
	if lifeStoryChoice(st, "education_plan") == "study_first" {
		studyDuration = studyDuration * 90 / 100
	}
	return startLifeProject(st, now, studyDuration, LifeActivity{
		Kind:"study", Target:id, Title:p.Title, GameDays:p.GameDays, HungerCost:18, EnergyCost:28, SkillGain:p.SkillGain, EducationLevel:p.Level,
	})
}

func (s *Service) lifeStartTraining(st *LifeState, id string, now time.Time) error {
	t, ok := findLifeTraining(id)
	if !ok { return ErrInput }
	if st.Cash < t.Cost { return ErrLifeFunds }
	if st.Energy < t.EnergyCost+8 || st.Hunger < 14 { return ErrLifeNeeds }
	if st.Active != nil { return ErrLifeBusy }
	st.Cash -= t.Cost
	return startLifeActivity(st, now, time.Duration(t.DurationSeconds)*time.Second, LifeActivity{
		Kind:"train", Target:id, Title:t.Title, GameDays:t.GameDays, HungerCost:5, EnergyCost:t.EnergyCost, SkillGain:t.SkillGain,
	})
}

func (s *Service) lifeStartRest(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	return startLifeActivity(st, now, 90*time.Second, LifeActivity{Kind:"rest", Target:"sleep", Title:"Сон", GameDays:1, HungerCost:5})
}

func (s *Service) lifeEat(st *LifeState, id string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	meal, ok := findLifeMeal(id)
	if !ok { return ErrInput }
	if meal.Emergency {
		// Emergency food is gated by the actual situation, not by a wall-clock
		// cooldown. It cannot be farmed for money and exists only to prevent a
		// dead-end when the character is broke and genuinely hungry.
		if st.Cash >= 1000 || st.Hunger > 25 { return ErrLifeLocked }
	} else {
		if st.Cash < meal.Cost { return ErrLifeFunds }
		st.Cash -= meal.Cost
	}
	st.Hunger = clampLife(st.Hunger + meal.HungerGain)
	st.Health = clampLife(st.Health + meal.HealthGain)
	st.Mood = clampLife(st.Mood + meal.MoodGain)
	lifeHistory(st, now, "life", meal.Title, "Сытость восстановлена.")
	return nil
}

func (s *Service) lifeBuyHome(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	level, err := strconv.Atoi(target)
	if err != nil || level != st.MaxHome+1 { return ErrInput }
	var home *LifeHomeOption
	for i := range lifeHomes { if lifeHomes[i].Level == level { home = &lifeHomes[i]; break } }
	if home == nil { return ErrInput }
	if st.Cash < home.Cost { return ErrLifeFunds }
	st.Cash -= home.Cost
	st.Home = level
	st.MaxHome = level
	st.Mood = clampLife(st.Mood + home.MoodBonus)
	st.Reputation = clampLife(st.Reputation + level)
	lifeHistory(st, now, "asset", "Новое жильё", home.Title)
	return nil
}

func (s *Service) lifeHomeSelect(st *LifeState, target string) error {
	level, err := strconv.Atoi(target)
	if err != nil || level < 0 || level > st.MaxHome { return ErrLifeLocked }
	st.Home = level
	return nil
}

func (s *Service) lifeStartBusiness(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company != nil { return ErrLifeLocked }
	tier, _ := findLifeBusinessTier(1)
	requiredLevel := tier.MinLevel
	if lifeStoryChoice(st, "founder_question") == "career" { requiredLevel = max(requiredLevel, 60) }
	if lifeLevel(st) < requiredLevel || st.Skills.Management < tier.MinManagement || st.Skills.Finance < tier.MinFinance { return ErrLifeLocked }
	if st.Cash < tier.UpgradeCost { return ErrLifeFunds }
	st.Cash -= tier.UpgradeCost
	st.Company = &LifeCompanyState{
		Tier:1, Staff:1, Brand:3, Cash:tier.UpgradeCost, Industry:"services",
		MarketShare:1, Innovation:3, Valuation:tier.UpgradeCost*3, Ownership:100,
		Departments:map[string]int{}, Regions:[]string{"home"}, Products:[]LifeCompanyProductState{},
	}
	st.Reputation = clampLife(st.Reputation + 3)
	lifeHistory(st, now, "business", "Бизнес зарегистрирован", "Открыта "+tier.Title+". Личные деньги и деньги компании теперь разделены.")
	return nil
}

func (s *Service) lifeStartBusinessCycle(st *LifeState, strategy string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil { return ErrLifeLocked }
	if strategy != "steady" && strategy != "growth" && strategy != "quality" { return ErrInput }
	tier, ok := findLifeBusinessTier(st.Company.Tier)
	if !ok { return ErrInput }
	if st.Energy < 18 || st.Hunger < 16 { return ErrLifeNeeds }
	title := map[string]string{"steady":"Стабильный цикл","growth":"Агрессивный рост","quality":"Ставка на качество"}[strategy]
	return startLifeActivity(st, now, time.Duration(tier.CycleSeconds)*time.Second, LifeActivity{Kind:"business_cycle", Target:strategy, Title:title, GameDays:30, HungerCost:9, EnergyCost:18})
}

func (s *Service) finishBusinessCycle(st *LifeState, strategy string, now time.Time) {
	if st.Company == nil { return }
	tier, ok := findLifeBusinessTier(st.Company.Tier)
	if !ok { return }

	industry, _ := findLifeIndustry(st.Company.Industry)
	risk := 6 + industry.Volatility/2
	margin := 18 + industry.MarginBonus
	brandGain := 1
	staffGain := 1
	if strategy == "growth" {
		risk += 8
		margin -= 7
		brandGain = 3
	}
	if strategy == "quality" {
		risk += 2
		margin -= 4
		brandGain = 5
	}
	risk -= lifeCompanyRiskReduction(st)
	protection := (st.Skills.Management + st.Skills.Finance + st.Company.Brand) / 30
	risk = max(2, risk-protection)

	baseRevenue := tier.BaseRevenue + lifeCompanyExtraRevenue(st)
	economyFactor := lifeEconomyBusinessFactor(st)
	market := 75 + random(51)
	grossProfit := baseRevenue * int64(max(2, margin)) * int64(market) * int64(economyFactor) / 1_000_000
	payroll := int64(st.Company.Staff) * int64(1800+st.Company.Tier*1200)
	departmentLevels := 0
	for _, level := range st.Company.Departments { departmentLevels += level }
	overhead := int64(departmentLevels) * int64(20_000*max(1, st.Company.Tier))
	debtInterest := st.Company.Debt / 100

	if random(100) < risk {
		lossPercent := 4 + random(9) + industry.Volatility/2
		loss := baseRevenue * int64(lossPercent) / 100
		loss += payroll/2 + debtInterest
		if loss > st.Company.Cash {
			st.Company.Debt += loss - st.Company.Cash
			st.Company.Cash = 0
		} else {
			st.Company.Cash -= loss
		}
		st.Company.LastProfit = -loss
		st.Company.Brand = clampLife(st.Company.Brand - (1 + random(3)))
		st.Company.DividendReady = false
		st.Company.MarketShare = clampLife(st.Company.MarketShare - 1)
		st.Experience += 1 + st.Company.Tier
		st.Reputation = clampLife(st.Reputation - 1)
		st.Company.Valuation = max(int64(50_000), st.Company.Valuation-loss*2)
		lifeHistory(st, now, "business", "Месяц не выстрелил", fmt.Sprintf("Убыток %d ₽ · риск %d%% · экономика %s.", loss, risk, st.Economy.Phase))
		return
	}

	if next, ok := findLifeBusinessTier(st.Company.Tier+1); ok && strategy == "growth" {
		staffGain = max(2, (next.MinStaff-st.Company.Staff+4)/5)
	}
	net := grossProfit - payroll - overhead - debtInterest
	if net >= 0 {
		st.Company.Cash += net
		st.Company.DividendReady = true
	} else {
		deficit := -net
		if deficit > st.Company.Cash {
			st.Company.Debt += deficit - st.Company.Cash
			st.Company.Cash = 0
		} else {
			st.Company.Cash -= deficit
		}
		st.Company.DividendReady = false
	}
	st.Company.LastProfit = net
	st.Company.Staff += staffGain
	st.Company.Brand = clampLife(st.Company.Brand + brandGain + st.Company.Departments["marketing"]/4)
	st.Company.MarketShare = clampLife(st.Company.MarketShare + max(0, st.Company.Departments["sales"]/5))
	st.Company.Innovation = clampLife(st.Company.Innovation + st.Company.Departments["technology"]/6)
	st.Experience += 3 + st.Company.Tier
	st.Reputation = clampLife(st.Reputation + 1)
	st.Company.Valuation = max(int64(100_000), st.Company.Cash*3+baseRevenue*6-st.Company.Debt*2)
	lifeHistory(st, now, "business", "Месяц компании закрыт", fmt.Sprintf("Результат %d ₽ · сотрудники +%d · бренд %d · стоимость %d ₽.", net, staffGain, st.Company.Brand, st.Company.Valuation))
}

func (s *Service) lifeBusinessHire(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil { return ErrLifeLocked }
	count, err := strconv.Atoi(target)
	if err != nil || count < 1 || count > 5000 { return ErrInput }
	cost := int64(count) * int64(4000*st.Company.Tier*st.Company.Tier)
	if st.Company.Cash < cost { return ErrLifeFunds }
	st.Company.Cash -= cost
	st.Company.Staff += count
	lifeHistory(st, now, "business", "Команда выросла", fmt.Sprintf("Нанято %d человек за %d ₽.", count, cost))
	return nil
}

func (s *Service) lifeBusinessInvest(st *LifeState, target string, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil { return ErrLifeLocked }
	amount, err := strconv.ParseInt(target, 10, 64)
	if err != nil || amount < 1000 || amount > 1_000_000_000_000 { return ErrInput }
	if st.Cash < amount { return ErrLifeFunds }
	st.Cash -= amount
	st.Company.Cash += amount
	lifeHistory(st, now, "business", "Вложение в компанию", fmt.Sprintf("%d ₽ переведено из личных денег в капитал бизнеса.", amount))
	return nil
}

func (s *Service) lifeBusinessExpand(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || st.Company.Tier >= len(lifeBusinessTiers) { return ErrLifeLocked }
	next, ok := findLifeBusinessTier(st.Company.Tier+1)
	if !ok { return ErrLifeLocked }
	if lifeLevel(st) < next.MinLevel || st.Company.Staff < next.MinStaff || st.Company.Brand < next.MinBrand || st.Skills.Management < next.MinManagement || st.Skills.Finance < next.MinFinance { return ErrLifeLocked }
	if st.Company.Cash < next.UpgradeCost { return ErrLifeFunds }
	if err := checkLifeProjectSlot(st, "business_expand", "expand"); err != nil { return err }
	st.Company.Cash -= next.UpgradeCost
	return startLifeProject(st, now, time.Duration(next.UpgradeSeconds)*time.Second, LifeActivity{
		Kind:"business_expand", Target:"expand", Title:"Масштабирование: "+next.Title, GameDays:90, HungerCost:12, EnergyCost:25, TargetLevel:next.Level,
	})
}

func (s *Service) lifeBusinessDividend(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Company == nil || !st.Company.DividendReady { return ErrLifeLocked }
	tier, ok := findLifeBusinessTier(st.Company.Tier)
	if !ok { return ErrInput }
	distributable := min(st.Company.Cash/10, tier.BaseRevenue/4)
	if distributable <= 0 { return ErrLifeFunds }
	ownership := st.Company.Ownership
	if ownership <= 0 { ownership = 100 }
	amount := distributable * int64(ownership) / 100
	if amount <= 0 { return ErrLifeFunds }
	st.Company.Cash -= distributable
	st.Cash += amount
	st.TotalEarned += amount
	st.Company.DividendReady = false
	lifeHistory(st, now, "business", "Дивиденды", fmt.Sprintf("%d ₽ получено владельцем при доле %d%%. Компания распределила %d ₽.", amount, ownership, distributable))
	return nil
}

func (s *Service) lifeRepayDebt(st *LifeState, now time.Time) error {
	if st.Active != nil { return ErrLifeBusy }
	if st.Debt <= 0 || st.Cash <= 0 { return ErrLifeLocked }
	amount := min(st.Cash, st.Debt)
	st.Cash -= amount
	st.Debt -= amount
	st.Finance.CreditScore = min(850, st.Finance.CreditScore+5)
	st.Mood = clampLife(st.Mood + 2)
	lifeHistory(st, now, "finance", "Долг уменьшен", fmt.Sprintf("Погашено %d ₽.", amount))
	return nil
}

func (s *Service) maybeLifeEvent(st *LifeState) bool {
	var candidates []lifeEventDef
	for _, event := range lifeEventDefs {
		if event.NeedsCompany && st.Company == nil { continue }
		if event.NeedsCareer && st.Career == nil { continue }
		if event.NeedsTransport && !hasLifeTransport(st) { continue }
		if event.MinCompanyTier > 0 && (st.Company == nil || st.Company.Tier < event.MinCompanyTier) { continue }
		if event.MinStress > st.Lifestyle.Stress || event.MinHome > st.Home { continue }
		if event.MinFriends > st.Network.Friends || event.MinContacts > st.Network.ProfessionalContacts { continue }
		if event.MinEducation > st.Education || event.MinExperience > st.Experience || event.MinCash > st.Cash { continue }
		candidates = append(candidates, event)
	}
	if len(candidates) == 0 { return false }
	event := candidates[random(len(candidates))]
	applyLifeEventEffect(st, event.StartEffect)
	pending := &LifePendingEvent{ID:event.ID, Title:event.Title, Text:event.Text, Severity:event.Severity}
	for _, option := range event.Choices {
		pending.Options = append(pending.Options, LifeEventOption{ID:option.ID, Title:option.Title, Hint:option.Hint})
	}
	st.PendingEvent = pending
	return true
}

func findLifeEventDef(id string) (lifeEventDef, bool) {
	for _, event := range lifeEventDefs { if event.ID == id { return event, true } }
	return lifeEventDef{}, false
}

func (s *Service) lifeResolveEvent(st *LifeState, choiceID string, now time.Time) error {
	if st.PendingEvent == nil { return ErrLifeLocked }
	if st.PendingEvent.Kind == "story" || st.PendingEvent.StoryID != "" {
		nodeID := st.PendingEvent.StoryID
		if nodeID == "" && len(st.PendingEvent.ID) > 6 && st.PendingEvent.ID[:6] == "story:" {
			nodeID = st.PendingEvent.ID[6:]
		}
		return lifeResolveStoryChoice(st, nodeID, choiceID, now)
	}
	event, ok := findLifeEventDef(st.PendingEvent.ID)
	if !ok { return ErrInput }
	for _, choice := range event.Choices {
		if choice.ID != choiceID { continue }
		applyLifeEventEffect(st, choice.Effect)
		lifeHistory(st, now, "event", event.Title, choice.Title)
		st.PendingEvent = nil
		return nil
	}
	return ErrInput
}

func applyLifeEventEffect(st *LifeState, e lifeEventEffect) {
	personalDelta := st.Cash*int64(e.CashPercent)/100 + e.CashFlat
	if personalDelta < 0 && st.Finance.Insurance > 0 {
		protection := min(40, st.Finance.Insurance*12)
		personalDelta = personalDelta * int64(100-protection) / 100
	}
	changeLifeMoney(&st.Cash, &st.Debt, personalDelta)
	if st.Company != nil {
		companyDelta := st.Company.Cash*int64(e.CompanyCashPercent)/100 + e.CompanyCashFlat
		if companyDelta < 0 && st.Company.Departments["legal"] > 0 {
			protection := min(35, st.Company.Departments["legal"]*4)
			companyDelta = companyDelta * int64(100-protection) / 100
		}
		st.Company.Cash = max(int64(0), st.Company.Cash+companyDelta)
		st.Company.Brand = clampLife(st.Company.Brand + e.Brand)
		st.Company.Staff = max(1, st.Company.Staff+e.Staff)
		st.Company.MarketShare = clampLife(st.Company.MarketShare + e.MarketShare)
		st.Company.Innovation = clampLife(st.Company.Innovation + e.Innovation)
	}
	if st.Career != nil {
		st.Career.Performance = clampLife(st.Career.Performance + e.CareerPerformance)
		st.Career.Stability = clampLife(st.Career.Stability + e.CareerStability)
	}
	st.Network.Friends = max(0, st.Network.Friends+e.Friends)
	st.Network.ProfessionalContacts = max(0, st.Network.ProfessionalContacts+e.Contacts)
	st.Network.Mentors = max(0, st.Network.Mentors+e.Mentors)
	st.Network.FamilyBond = clampLife(st.Network.FamilyBond + e.FamilyBond)
	st.Network.Relationship = clampLife(st.Network.Relationship + e.Relationship)
	st.Finance.CreditScore = max(300, min(850, st.Finance.CreditScore+e.CreditScore))
	st.Health = clampLife(st.Health + e.Health)
	st.Mood = clampLife(st.Mood + e.Mood)
	st.Reputation = clampLife(st.Reputation + e.Reputation)
	st.Lifestyle.Stress = clampLife(st.Lifestyle.Stress + e.Stress)
	st.Lifestyle.Fitness = clampLife(st.Lifestyle.Fitness + e.Fitness)
	addLifeSkills(&st.Skills, e.Skills)
}

func changeLifeMoney(cash *int64, debt *int64, delta int64) {
	if delta >= 0 {
		*cash += delta
		return
	}
	next := *cash + delta
	if next >= 0 {
		*cash = next
		return
	}
	*cash = 0
	*debt += -next
}
