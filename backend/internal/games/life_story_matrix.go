package games

import (
	"fmt"
	"strings"
)

// The authored story matrix expands the fixed milestone arc into thousands of
// contextual scenes without turning the game into a wall of random popups.
// It deliberately combines authored era context, life domain, concrete
// situation and dilemma. The combination is deterministic for the current
// state, so reloading cannot reroll a more convenient choice.
type lifeStoryMatrixEra struct {
	Title   string
	Opening string
}

type lifeStoryMatrixDomain struct {
	ID       string
	Title    string
	Lens     string
	Stakes   string
	ChoiceA  string
	HintA    string
	ChoiceB  string
	HintB    string
	ApplyA   func(*LifeState)
	ApplyB   func(*LifeState)
}

type lifeStoryMatrixSituation struct {
	ID     string
	Title  string
	Setup  string
	Detail string
}

type lifeStoryMatrixTension struct {
	ID       string
	Title    string
	Pressure string
	Question string
	Severity string
	MoveA    string
	HintA    string
	MoveB    string
	HintB    string
	ApplyA   func(*LifeState)
	ApplyB   func(*LifeState)
}

var lifeStoryMatrixEras = []lifeStoryMatrixEra{
	{Title:"Выживание", Opening:"Денег почти нет, запас прочности маленький, поэтому даже обычная бытовая мелочь ощущается как решение с последствиями."},
	{Title:"Первые опоры", Opening:"Вы уже не живёте одним сегодняшним днём: появляется небольшой запас, планы на учёбу и понимание, что случайные решения начинают складываться в привычки."},
	{Title:"Самостоятельность", Opening:"Появилась собственная траектория: работа, бюджет и люди вокруг больше не выглядят временными. Ошибки теперь стоят дороже, но и выборов стало больше."},
	{Title:"Профессия", Opening:"Вы перестали быть новичком. От вас ждут не присутствия, а результата, и становится заметно, какие решения строят профессию, а какие просто заполняют календарь."},
	{Title:"Сильный специалист", Opening:"Доход и компетенции уже дают свободу, но вместе с ней приходит новая проблема: нельзя одновременно выбрать максимум денег, спокойствия, статуса и личного времени."},
	{Title:"Руководитель", Opening:"Часть последствий теперь касается не только вас. Люди рассчитывают на ваши решения, а цена импульсивности измеряется чужим временем, бюджетом и доверием."},
	{Title:"Предприниматель", Opening:"Стабильность больше не гарантирована зарплатой. Компания, продукт и команда превращают личные решения в систему, которая может усиливать как хорошие, так и плохие привычки."},
	{Title:"Большой бизнес", Opening:"Ручное управление перестаёт работать. Любой выбор приходится оценивать не по одному удачному месяцу, а по тому, выдержит ли его организация из сотен людей."},
	{Title:"Международный бизнес", Opening:"Один и тот же поступок теперь по-разному воспринимают клиенты, сотрудники и партнёры в разных странах. Простые ответы заканчиваются раньше, чем сложные последствия."},
	{Title:"Глобальная корпорация", Opening:"Деньги уже не главная редкость. Ограничением становятся внимание, доверие, преемственность и способность не потерять смысл за масштабом созданной системы."},
}

var lifeStoryMatrixDomains = []lifeStoryMatrixDomain{
	{
		ID:"money", Title:"Деньги",
		Lens:"Вопрос упирается не в красивую цифру на счёте, а в то, какую свободу даст или отнимет следующий финансовый шаг.",
		Stakes:"Последствия отражаются на запасе прочности, финансовой дисциплине и способности пережить следующую неприятность без паники.",
		ChoiceA:"Сначала сохранить запас", HintA:"Не брать лишний риск и укрепить финансовую дисциплину.",
		ChoiceB:"Использовать деньги для жизни сейчас", HintB:"Получить немного комфорта и настроения, не превращая каждую копейку в культ накопления.",
		ApplyA:func(st *LifeState) { st.Skills.Finance=clampLife(st.Skills.Finance+2); st.Skills.Discipline=clampLife(st.Skills.Discipline+1) },
		ApplyB:func(st *LifeState) { st.Mood=clampLife(st.Mood+3); st.Lifestyle.Comfort=clampLife(st.Lifestyle.Comfort+2) },
	},
	{
		ID:"work", Title:"Работа",
		Lens:"Здесь важно не просто заработать ещё, а решить, каким человеком вы становитесь в рабочем ритме: надёжным, удобным, амбициозным или выгоревшим.",
		Stakes:"Решение постепенно меняет опыт, дисциплину, коммуникацию и отношение к нагрузке.",
		ChoiceA:"Взять ответственность на себя", HintA:"Чуть тяжелее сейчас, зато растут дисциплина и профессиональная уверенность.",
		ChoiceB:"Не тащить всё одному", HintB:"Сохранить границы и решать задачу через разговор и распределение нагрузки.",
		ApplyA:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+2); st.Experience++; st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+1) },
		ApplyB:func(st *LifeState) { st.Skills.Communication=clampLife(st.Skills.Communication+2); st.Mood=clampLife(st.Mood+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-1) },
	},
	{
		ID:"learning", Title:"Учёба и навыки",
		Lens:"Нельзя изучить всё. Полезность следующего шага зависит от того, станет ли знание рабочим инструментом или останется ещё одной строкой в списке пройденного.",
		Stakes:"Выбор меняет глубину знаний, цифровые навыки и способность учиться без бесконечного коллекционирования курсов.",
		ChoiceA:"Разобраться глубже", HintA:"Меньше ширины, больше настоящего понимания и практики.",
		ChoiceB:"Расширить кругозор", HintB:"Взять соседнюю область и научиться лучше разговаривать с людьми из другой специализации.",
		ApplyA:func(st *LifeState) { st.Lifestyle.Knowledge=clampLife(st.Lifestyle.Knowledge+3); st.Skills.Digital=clampLife(st.Skills.Digital+1); st.Skills.Discipline=clampLife(st.Skills.Discipline+1) },
		ApplyB:func(st *LifeState) { st.Lifestyle.Knowledge=clampLife(st.Lifestyle.Knowledge+2); st.Skills.Communication=clampLife(st.Skills.Communication+1); st.Skills.Management=clampLife(st.Skills.Management+1) },
	},
	{
		ID:"home", Title:"Дом и быт",
		Lens:"Быт незаметно съедает силы или возвращает их. Решение кажется мелким только до тех пор, пока подобные мелочи не повторяются каждый день.",
		Stakes:"Меняются комфорт, настроение и дисциплина повседневной жизни.",
		ChoiceA:"Сделать жизнь удобнее", HintA:"Потратить внимание на комфорт и убрать постоянное мелкое раздражение.",
		ChoiceB:"Оставить быт простым", HintB:"Не раздувать потребности и направить силы в другие части жизни.",
		ApplyA:func(st *LifeState) { st.Lifestyle.Comfort=clampLife(st.Lifestyle.Comfort+3); st.Mood=clampLife(st.Mood+2) },
		ApplyB:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+2); st.Skills.Finance=clampLife(st.Skills.Finance+1) },
	},
	{
		ID:"people", Title:"Люди",
		Lens:"Отношения редко ломаются одним большим событием. Чаще они меняются от того, кому вы отвечаете, кого слышите и на кого постоянно не хватает времени.",
		Stakes:"Выбор влияет на близость, друзей, профессиональные связи и настроение.",
		ChoiceA:"Выделить время близким", HintA:"Поддержать отношения не словами, а конкретным вниманием.",
		ChoiceB:"Сделать ставку на новые связи", HintB:"Расширить круг людей и профессиональных контактов, понимая цену такого фокуса.",
		ApplyA:func(st *LifeState) { st.Network.FamilyBond=clampLife(st.Network.FamilyBond+3); st.Network.Relationship=clampLife(st.Network.Relationship+2); st.Mood=clampLife(st.Mood+2) },
		ApplyB:func(st *LifeState) { st.Network.ProfessionalContacts++; st.Network.Friends++; st.Reputation=clampLife(st.Reputation+1); st.Skills.Communication=clampLife(st.Skills.Communication+1) },
	},
	{
		ID:"health", Title:"Здоровье и ритм",
		Lens:"Организм не видит разницы между «важным дедлайном» и привычкой постоянно откладывать восстановление. Он просто накапливает счёт.",
		Stakes:"Последствия идут в здоровье, форму, энергию и стресс, а затем возвращаются в работу и отношения.",
		ChoiceA:"Восстановиться нормально", HintA:"Снизить темп и вернуть телу ресурс вместо ещё одного рывка.",
		ChoiceB:"Сохранить привычный темп", HintB:"Не выпадать из дел, но компенсировать нагрузку более аккуратным режимом.",
		ApplyA:func(st *LifeState) { st.Health=clampLife(st.Health+3); st.Energy=clampLife(st.Energy+4); st.Lifestyle.Fitness=clampLife(st.Lifestyle.Fitness+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-3) },
		ApplyB:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+1); st.Mood=clampLife(st.Mood+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+1) },
	},
	{
		ID:"reputation", Title:"Репутация",
		Lens:"Репутация строится не из громких слов, а из совпадения обещаний с поступками. Иногда выгоднее выглядеть сильным, иногда — честно признать ограничение.",
		Stakes:"Решение влияет на доверие, коммуникацию и внутреннее напряжение от необходимости соответствовать образу.",
		ChoiceA:"Взять публичную ответственность", HintA:"Назвать позицию прямо и отвечать за результат.",
		ChoiceB:"Сделать работу без шума", HintB:"Не продавать обещание раньше результата и укрепить привычку доводить дело до конца.",
		ApplyA:func(st *LifeState) { st.Reputation=clampLife(st.Reputation+2); st.Skills.Communication=clampLife(st.Skills.Communication+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+1) },
		ApplyB:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-1) },
	},
	{
		ID:"risk", Title:"Риск",
		Lens:"Любой рост требует риска, но риск ради ощущения движения ничем не лучше бездействия. Важны предел потерь и причина, ради которой вы их принимаете.",
		Stakes:"Меняются финансовое мышление, управленческая смелость, стресс и устойчивость к следующей ошибке.",
		ChoiceA:"Принять ограниченный риск", HintA:"Сделать шаг вперёд, заранее понимая худший допустимый результат.",
		ChoiceB:"Сохранить запасной выход", HintB:"Отказаться от максимального выигрыша ради большей устойчивости.",
		ApplyA:func(st *LifeState) { st.Skills.Finance=clampLife(st.Skills.Finance+2); st.Skills.Management=clampLife(st.Skills.Management+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+2) },
		ApplyB:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+1); st.Finance.CreditScore=min(850, st.Finance.CreditScore+3); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-1) },
	},
	{
		ID:"future", Title:"Будущее",
		Lens:"Некоторые решения не дают заметной награды сегодня. Их смысл проявляется позже — в количестве доступных вариантов, когда обстоятельства внезапно меняются.",
		Stakes:"Выбор влияет на управленческое мышление, знания, комфорт и способность не жить исключительно следующим дедлайном.",
		ChoiceA:"Играть в длинную", HintA:"Выбрать то, что расширяет будущие варианты, даже если сейчас это выглядит скромнее.",
		ChoiceB:"Не откладывать всю жизнь на потом", HintB:"Оставить место для нормальной жизни сейчас и не превращать развитие в бесконечную подготовку.",
		ApplyA:func(st *LifeState) { st.Skills.Management=clampLife(st.Skills.Management+2); st.Lifestyle.Knowledge=clampLife(st.Lifestyle.Knowledge+2); st.Skills.Finance=clampLife(st.Skills.Finance+1) },
		ApplyB:func(st *LifeState) { st.Mood=clampLife(st.Mood+3); st.Lifestyle.Comfort=clampLife(st.Lifestyle.Comfort+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-1) },
	},
}

var lifeStoryMatrixSituations = []lifeStoryMatrixSituation{
	{ID:"bill", Title:"Незапланированный счёт", Setup:"В обычный день появляется расход или обязательство, которого не было в плане. Сумма сама по себе не катастрофическая, но она ломает аккуратно собранный ритм.", Detail:"Такие эпизоды проверяют не богатство, а качество системы вокруг него."},
	{ID:"message", Title:"Сообщение, которое нельзя игнорировать", Setup:"Приходит сообщение от человека, чьё мнение или участие действительно что-то меняет. Быстрого нейтрального ответа здесь нет: молчание тоже станет ответом.", Detail:"Нужно решить не только что сказать, но и какое место этот человек занимает в вашей жизни."},
	{ID:"morning", Title:"Редкое свободное утро", Setup:"В календаре неожиданно появляется несколько свободных часов. Никто не заставляет тратить их «правильно», и именно поэтому выбор хорошо показывает реальные приоритеты.", Detail:"Свободное время часто точнее планов показывает, куда человек на самом деле движется."},
	{ID:"setback", Title:"Неприятный результат", Setup:"То, на что вы рассчитывали, срабатывает хуже ожиданий. Ошибка не уничтожает прогресс, но достаточно заметна, чтобы нельзя было просто сделать вид, будто ничего не произошло.", Detail:"После неудачи важнее способ реакции, чем желание быстро вернуть ощущение контроля."},
	{ID:"offer", Title:"Слишком удобное предложение", Setup:"Появляется вариант, который обещает заметно облегчить ближайшие недели. У него нет очевидной ловушки, но цена спрятана в будущих обязательствах.", Detail:"Хорошее предложение отличается от опасно удобного тем, что выдерживает проверку последствиями."},
	{ID:"conflict", Title:"Разногласие", Setup:"Кто-то рядом видит ситуацию иначе и не собирается уступать только потому, что вы уверены в своей правоте. Разговор быстро перестаёт быть чисто техническим.", Detail:"Конфликт показывает, умеете ли вы защищать решение, не превращая несогласие в борьбу за статус."},
	{ID:"fatigue", Title:"Конец тяжёлой недели", Setup:"Несколько напряжённых дней подряд сделали простые решения раздражающе сложными. Хочется либо всё бросить, либо одним рывком закрыть накопившееся.", Detail:"Усталость редко создаёт новые проблемы — чаще она снимает фильтры с уже существующих."},
	{ID:"change", Title:"Планы внезапно изменились", Setup:"То, на чём строился ближайший план, сдвигается: человек отменяет встречу, задача переносится, рынок или работодатель меняет условия.", Detail:"Гибкость полезна до тех пор, пока не превращается в постоянную жизнь без собственных правил."},
	{ID:"review", Title:"Разбор результата", Setup:"Появляется возможность спокойно посмотреть назад и понять, что именно сработало. Цифры и факты не полностью совпадают с ощущением от прошедшего периода.", Detail:"Хороший разбор нужен не ради самооценки, а чтобы следующее решение не основывалось на удобной памяти."},
}

var lifeStoryMatrixTensions = []lifeStoryMatrixTension{
	{
		ID:"scarcity", Title:"Когда всего немного",
		Pressure:"Проблема в том, что ресурсов хватает только на один хороший вариант: попытка сделать всё сразу почти гарантированно ухудшит оба.",
		Question:"Что важнее сохранить, когда невозможно сохранить всё?", Severity:"warning",
		MoveA:"Сохранить основу", HintA:"Сделать выбор в пользу устойчивости, даже если награда почти не чувствуется сегодня.",
		MoveB:"Поддержать себя сейчас", HintB:"Не дать дефициту превратить жизнь в постоянный режим наказания.",
		ApplyA:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+1); st.Skills.Finance=clampLife(st.Skills.Finance+1) },
		ApplyB:func(st *LifeState) { st.Mood=clampLife(st.Mood+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-1) },
	},
	{
		ID:"uncertainty", Title:"Нет полной информации",
		Pressure:"Никто не может гарантировать правильный исход. Можно собрать ещё немного фактов, но момент, когда решение всё равно придётся принять, уже близко.",
		Question:"Как действовать, когда уверенность недоступна в принципе?", Severity:"warning",
		MoveA:"Решить по имеющимся фактам", HintA:"Зафиксировать допущения и взять ответственность за решение без иллюзии полной уверенности.",
		MoveB:"Сначала поговорить с людьми", HintB:"Использовать чужой опыт, не перекладывая на других сам выбор.",
		ApplyA:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+1) },
		ApplyB:func(st *LifeState) { st.Skills.Communication=clampLife(st.Skills.Communication+1); st.Network.ProfessionalContacts++ },
	},
	{
		ID:"speed", Title:"Нужно быстрее",
		Pressure:"Главный соблазн — решить проблему скоростью: ещё один рывок действительно может помочь, но легко превращается в стандартный способ жить.",
		Question:"Ускориться сейчас или защитить темп, который можно выдерживать долго?", Severity:"warning",
		MoveA:"Сделать короткий рывок", HintA:"Ускориться осознанно и принять небольшую цену по ресурсу.",
		MoveB:"Не ломать устойчивый ритм", HintB:"Сохранить здоровье и качество решений, даже если результат придёт позже.",
		ApplyA:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+2); st.Energy=clampLife(st.Energy-2) },
		ApplyB:func(st *LifeState) { st.Health=clampLife(st.Health+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-2) },
	},
	{
		ID:"loyalty", Title:"Свои тоже чего-то ждут",
		Pressure:"Решение затрагивает человека или группу, которые раньше помогали вам. Формально вы им ничего не должны, но отношения редко живут только формальными обязательствами.",
		Question:"Где заканчивается благодарность и начинается обязанность жить чужими ожиданиями?", Severity:"warning",
		MoveA:"Учесть прежние отношения", HintA:"Не забывать людей, которые были рядом до нынешнего результата.",
		MoveB:"Отделить благодарность от решения", HintB:"Сохранить уважение, но не отдавать другим право выбирать вашу траекторию.",
		ApplyA:func(st *LifeState) { st.Network.FamilyBond=clampLife(st.Network.FamilyBond+2); st.Network.Relationship=clampLife(st.Network.Relationship+1); st.Mood=clampLife(st.Mood+1) },
		ApplyB:func(st *LifeState) { st.Reputation=clampLife(st.Reputation+1); st.Skills.Discipline=clampLife(st.Skills.Discipline+1) },
	},
	{
		ID:"boundaries", Title:"Граница нагрузки",
		Pressure:"Можно согласиться ещё раз, но становится ясно: окружающие уже воспринимают вашу доступность как настройку по умолчанию.",
		Question:"Сказать «нет» сейчас или снова решить проблему за счёт собственного времени?", Severity:"warning",
		MoveA:"Обозначить границу", HintA:"Сохранить ресурс и показать, что ваше время тоже имеет цену.",
		MoveB:"Помочь ещё один раз", HintB:"Поддержать ситуацию сейчас, принимая небольшой дополнительный стресс.",
		ApplyA:func(st *LifeState) { st.Health=clampLife(st.Health+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-3); st.Skills.Communication=clampLife(st.Skills.Communication+1) },
		ApplyB:func(st *LifeState) { st.Reputation=clampLife(st.Reputation+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+2) },
	},
	{
		ID:"pride", Title:"Очень хочется доказать",
		Pressure:"Часть мотивации уже не про результат, а про желание показать, что вы были правы. Это может дать энергию, но легко делает дорогой отказ от плохой идеи.",
		Question:"Продолжить из принципа или разрешить себе изменить позицию?", Severity:"warning",
		MoveA:"Довести обещанное", HintA:"Взять ответственность за собственные слова и не искать удобного выхода.",
		MoveB:"Изменить решение при новых фактах", HintB:"Не путать последовательность с упрямством и сохранить способность учиться.",
		ApplyA:func(st *LifeState) { st.Reputation=clampLife(st.Reputation+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+1) },
		ApplyB:func(st *LifeState) { st.Lifestyle.Knowledge=clampLife(st.Lifestyle.Knowledge+1); st.Skills.Communication=clampLife(st.Skills.Communication+1) },
	},
	{
		ID:"fear", Title:"Страшно потерять уже достигнутое",
		Pressure:"Чем больше у вас есть, тем легче принять осторожность за здравый смысл. Но иногда отказ от любого риска незаметно становится отдельным риском.",
		Question:"Что сейчас опаснее: возможная ошибка или привычка не двигаться без гарантии?", Severity:"warning",
		MoveA:"Сделать контролируемый шаг", HintA:"Двигаться дальше, заранее ограничив размер возможной ошибки.",
		MoveB:"Сначала укрепить позицию", HintB:"Не спешить, пока запас прочности действительно не станет достаточным.",
		ApplyA:func(st *LifeState) { st.Skills.Management=clampLife(st.Skills.Management+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+1) },
		ApplyB:func(st *LifeState) { st.Skills.Finance=clampLife(st.Skills.Finance+1); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-2) },
	},
	{
		ID:"responsibility", Title:"Решение затронет других",
		Pressure:"Теперь нельзя оценивать вариант только по личной выгоде. Кто-то будет жить с последствиями вашего выбора, даже если не участвовал в обсуждении.",
		Question:"Как учитывать чужие интересы, не превращая решение в бесконечный поиск согласия всех?", Severity:"warning",
		MoveA:"Принять решение и объяснить его", HintA:"Не прятаться за коллективом и честно назвать цену выбранного пути.",
		MoveB:"Сначала собрать возражения", HintB:"Дать людям шанс показать слабое место до того, как оно станет проблемой.",
		ApplyA:func(st *LifeState) { st.Skills.Management=clampLife(st.Skills.Management+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress+2) },
		ApplyB:func(st *LifeState) { st.Skills.Communication=clampLife(st.Skills.Communication+2); st.Network.ProfessionalContacts++ },
	},
	{
		ID:"temptation", Title:"Быстрая награда рядом",
		Pressure:"Один вариант приятнее прямо сейчас и почти не требует усилий. Второй выглядит скучнее, зато не создаёт проблемы, которую придётся решать будущему вам.",
		Question:"Насколько сегодняшний комфорт должен весить против завтрашней свободы?", Severity:"warning",
		MoveA:"Разрешить себе быстрый выигрыш", HintA:"Поддержать настроение сейчас, не делая вид, будто у решения нет цены.",
		MoveB:"Оставить награду на потом", HintB:"Укрепить способность не менять долгую цель на короткое облегчение.",
		ApplyA:func(st *LifeState) { st.Mood=clampLife(st.Mood+3); st.Lifestyle.Comfort=clampLife(st.Lifestyle.Comfort+1) },
		ApplyB:func(st *LifeState) { st.Skills.Finance=clampLife(st.Skills.Finance+1); st.Skills.Discipline=clampLife(st.Skills.Discipline+2); st.Mood=clampLife(st.Mood-1) },
	},
	{
		ID:"identity", Title:"Это уже вопрос о вас",
		Pressure:"Практический выбор неожиданно упирается в более неприятный вопрос: вы действительно хотите этого результата или просто привыкли быть человеком, который к нему стремится?",
		Question:"Продолжить прежнюю линию или признать, что приоритеты могли измениться?", Severity:"good",
		MoveA:"Остаться на выбранном пути", HintA:"Укрепить последовательность и принять цену собственного приоритета.",
		MoveB:"Пересобрать приоритеты", HintB:"Не считать смену курса поражением, если старый курс больше не ваш.",
		ApplyA:func(st *LifeState) { st.Skills.Discipline=clampLife(st.Skills.Discipline+1); st.Reputation=clampLife(st.Reputation+1) },
		ApplyB:func(st *LifeState) { st.Lifestyle.Knowledge=clampLife(st.Lifestyle.Knowledge+2); st.Mood=clampLife(st.Mood+2); st.Lifestyle.Stress=clampLife(st.Lifestyle.Stress-1) },
	},
}

func init() {
	lifeStoryNodes = append(lifeStoryNodes, buildLifeStoryMatrix()...)
}

func buildLifeStoryMatrix() []lifeStoryNodeDef {
	const perEra = 9 * 9 * 10
	nodes := make([]lifeStoryNodeDef, 0, len(lifeStoryMatrixEras)*perEra)
	for eraIndex, era := range lifeStoryMatrixEras {
		eraNumber := eraIndex + 1
		for domainIndex, domain := range lifeStoryMatrixDomains {
			for situationIndex, situation := range lifeStoryMatrixSituations {
				for tensionIndex, tension := range lifeStoryMatrixTensions {
					localIndex := domainIndex*90 + situationIndex*10 + tensionIndex
					nodes = append(nodes, makeLifeStoryMatrixNode(eraNumber, localIndex, era, domain, situation, tension))
				}
			}
		}
	}
	return nodes
}

func makeLifeStoryMatrixNode(
	era int,
	localIndex int,
	eraDef lifeStoryMatrixEra,
	domain lifeStoryMatrixDomain,
	situation lifeStoryMatrixSituation,
	tension lifeStoryMatrixTension,
) lifeStoryNodeDef {
	id := fmt.Sprintf("matrix_e%02d_%s_%s_%s", era, domain.ID, situation.ID, tension.ID)
	setup := situation.Setup
	detail := situation.Detail
	if concrete, ok := lifeStoryConcreteDetailFor(domain.ID, situation.ID); ok {
		setup = concrete.Setup
		detail = concrete.Detail
	}
	return lifeStoryNodeDef{
		ID:id,
		Era:era,
		Title:fmt.Sprintf("%s · %s · %s", domain.Title, situation.Title, tension.Title),
		Text:fmt.Sprintf("%s\n\n%s\n\n%s\n\n%s", eraDef.Opening, setup, domain.Lens, tension.Pressure),
		Description:fmt.Sprintf("%s %s %s", detail, tension.Question, domain.Stakes),
		Severity:tension.Severity,
		Optional:true,
		Condition:func(st *LifeState) bool {
			if st.Days < 2 || lifeStoryMatrixEraNumber(st) != era { return false }
			if st.Story.LastBeatDay > 0 && st.Days-st.Story.LastBeatDay < lifeStoryMatrixCadence(era) { return false }
			return lifeStoryMatrixSlot(st) == localIndex
		},
		Choices:[]lifeStoryChoiceDef{
			{
				ID:"a",
				Title:tension.MoveA+": "+domain.ChoiceA,
				Hint:domain.HintA+" "+tension.HintA,
				Apply:func(st *LifeState) {
					lifeStoryRecordPattern(st, domain.ID, tension.ID, "a")
					if domain.ApplyA != nil { domain.ApplyA(st) }
					if tension.ApplyA != nil { tension.ApplyA(st) }
				},
			},
			{
				ID:"b",
				Title:tension.MoveB+": "+domain.ChoiceB,
				Hint:domain.HintB+" "+tension.HintB,
				Apply:func(st *LifeState) {
					lifeStoryRecordPattern(st, domain.ID, tension.ID, "b")
					if domain.ApplyB != nil { domain.ApplyB(st) }
					if tension.ApplyB != nil { tension.ApplyB(st) }
				},
			},
		},
	}
}


func lifeStoryRecordPattern(st *LifeState, domain, tension, choice string) {
	if st.Story.Patterns == nil { st.Story.Patterns = map[string]int{} }
	st.Story.Patterns["domain:"+domain+":"+choice]++
	st.Story.Patterns["tension:"+tension+":"+choice]++
}

func lifeStoryPatternContext(st *LifeState, node lifeStoryNodeDef) string {
	parts := strings.Split(node.ID, "_")
	if len(parts) < 5 || parts[0] != "matrix" { return "" }
	domain := parts[2]
	a := st.Story.Patterns["domain:"+domain+":a"]
	b := st.Story.Patterns["domain:"+domain+":b"]
	if a+b < 3 || a == b { return "" }

	styles := map[string][2]string{
		"money":      {"сначала сохраняли запас и свободу манёвра", "чаще разрешали деньгам улучшать жизнь прямо сейчас"},
		"work":       {"брали дополнительную ответственность на себя", "чаще распределяли нагрузку и защищали границы"},
		"learning":   {"углублялись в одну сильную сторону", "чаще расширяли кругозор и оставались универсалом"},
		"home":       {"вкладывались в удобство повседневной жизни", "чаще сохраняли быт простым и дешёвым"},
		"people":     {"берегли близкие связи", "чаще расширяли круг людей и профессиональных контактов"},
		"health":     {"останавливались ради нормального восстановления", "чаще сохраняли рабочий темп и адаптировали режим"},
		"reputation": {"брали публичную ответственность", "чаще сначала делали результат и только потом говорили о нём"},
		"risk":       {"принимали ограниченный и просчитанный риск", "чаще сохраняли запасной выход"},
		"future":     {"выбирали решения с длинным горизонтом", "чаще не откладывали качество жизни на неопределённое потом"},
	}
	style, ok := styles[domain]
	if !ok { return "" }
	chosen := style[0]
	count := a
	other := b
	if b > a {
		chosen = style[1]
		count = b
		other = a
	}
	return fmt.Sprintf(
		"Игра помнит предыдущие решения: в похожих ситуациях этой сферы вы чаще %s (%d решений против %d). Это не блокирует другой выбор сейчас, но новая сцена уже существует внутри сложившейся биографии.",
		chosen, count, other,
	)
}

func lifeStoryMatrixEraNumber(st *LifeState) int {
	level := st.Progression.Level
	if level < 1 { level = 1 }
	if level > 100 { level = 100 }
	return (level-1)/10 + 1
}

func lifeStoryMatrixCadence(era int) int {
	// Early game surfaces a scene every few played days. Later, one career or
	// company cycle can advance a month at once, so a larger cadence prevents
	// several scenes from stacking behind a single strategic action.
	switch {
	case era <= 2:
		return 3
	case era <= 4:
		return 5
	case era <= 6:
		return 8
	case era <= 8:
		return 14
	default:
		return 21
	}
}

func lifeStoryMatrixSlot(st *LifeState) int {
	seed := st.Days*17 +
		st.Experience*7 +
		max(1, st.Progression.Level)*13 +
		len(st.Story.Completed)*29 +
		st.Home*5 +
		st.Reputation*3 +
		st.Network.Friends*11 +
		st.Network.ProfessionalContacts*19
	if st.Career != nil {
		seed += st.Career.Months*23 + st.Career.Performance
	}
	if st.Company != nil {
		seed += st.Company.Tier*31 + st.Company.Staff + st.Company.Brand*7 + len(st.Company.Regions)*37
	}
	if seed < 0 { seed = -seed }
	return seed % (9 * 9 * 10)
}


func lifeStoryRenderedText(st *LifeState, node lifeStoryNodeDef) string {
	if !strings.HasPrefix(node.ID, "matrix_") {
		return node.Text
	}

	context := ""
	switch {
	case strings.Contains(node.ID, "_money_"):
		context = fmt.Sprintf(
			"Сейчас у вас %d ₽ наличными, %d ₽ в резерве и %d ₽ личного долга. Поэтому выбор ниже влияет не на условную «финансовую шкалу», а на ваш реальный запас свободы в этом прохождении.",
			st.Cash, st.Finance.Savings, st.Debt,
		)
	case strings.Contains(node.ID, "_work_"):
		if st.Career != nil {
			context = fmt.Sprintf(
				"Сейчас вы работаете как %s в %s: результативность %d/100, устойчивость позиции %d/100. Решение будет частью именно этой карьеры, а не отдельным случайным эпизодом.",
				st.Career.Title, st.Career.Employer, st.Career.Performance, st.Career.Stability,
			)
		} else {
			context = fmt.Sprintf(
				"Постоянной должности пока нет. У вас %d опыта и репутация %d/100, поэтому даже небольшое рабочее решение сейчас влияет на то, какие варианты откроются дальше.",
				st.Experience, st.Reputation,
			)
		}
	case strings.Contains(node.ID, "_learning_"):
		context = fmt.Sprintf(
			"Уровень образования сейчас %d из 4, получено прикладных квалификаций: %d. Знания %d/100, digital-навык %d/100 — выбор имеет смысл именно относительно уже пройденного пути.",
			st.Education, len(st.Lifestyle.Credentials), st.Lifestyle.Knowledge, st.Skills.Digital,
		)
	case strings.Contains(node.ID, "_home_"):
		context = fmt.Sprintf(
			"Ваш текущий уровень жилья — %d, комфорт %d/100. Энергия %d/100, сытость %d/100: бытовое решение напрямую связано с тем, в каком состоянии герой входит в следующий день.",
			st.Home, st.Lifestyle.Comfort, st.Energy, st.Hunger,
		)
	case strings.Contains(node.ID, "_people_"):
		context = fmt.Sprintf(
			"Сейчас рядом %d друзей, %d профессиональных контактов; близость с семьёй %d/100, отношения %d/100. У решения есть конкретные люди по другую сторону, а не безымянная «социальность».",
			st.Network.Friends, st.Network.ProfessionalContacts, st.Network.FamilyBond, st.Network.Relationship,
		)
	case strings.Contains(node.ID, "_health_"):
		context = fmt.Sprintf(
			"Здоровье %d/100, энергия %d/100, форма %d/100, стресс %d/100. То, что выглядит как ещё один небольшой рывок, может ощущаться совсем по-разному в зависимости от этих цифр.",
			st.Health, st.Energy, st.Lifestyle.Fitness, st.Lifestyle.Stress,
		)
	case strings.Contains(node.ID, "_reputation_"):
		context = fmt.Sprintf(
			"Ваша репутация сейчас %d/100, профессиональных контактов %d. Каждый публичный выбор немного меняет то, насколько легко люди будут верить следующему обещанию.",
			st.Reputation, st.Network.ProfessionalContacts,
		)
	case strings.Contains(node.ID, "_risk_"):
		if st.Company != nil {
			context = fmt.Sprintf(
				"У компании %d сотрудников, %d ₽ в кассе, бренд %d/100 и долг %d ₽. Риск здесь измеряется не абстрактной смелостью, а тем, сколько системы окажется под ударом.",
				st.Company.Staff, st.Company.Cash, st.Company.Brand, st.Company.Debt,
			)
		} else {
			context = fmt.Sprintf(
				"Ваш личный капитал сейчас около %d ₽, наличные %d ₽, долг %d ₽. Это задаёт реальный предел ошибки, которую можно пережить без обвала всей траектории.",
				lifeNetWorth(*st), st.Cash, st.Debt,
			)
		}
	case strings.Contains(node.ID, "_future_"):
		if st.Company != nil {
			context = fmt.Sprintf(
				"Вы на уровне жизни %d; компания оценивается примерно в %d ₽ и работает на %d рынках. Чем дальше путь, тем важнее не только следующий результат, но и то, какую систему вы оставляете после него.",
				st.Progression.Level, st.Company.Valuation, len(st.Company.Regions),
			)
		} else {
			context = fmt.Sprintf(
				"Вы на уровне жизни %d, общий капитал около %d ₽, опыт %d. Следующее решение важно не само по себе, а тем, какие варианты оно сохранит через несколько этапов.",
				st.Progression.Level, lifeNetWorth(*st), st.Experience,
			)
		}
	}

	pattern := lifeStoryPatternContext(st, node)
	if context == "" {
		if pattern == "" { return node.Text }
		return node.Text + "\n\n" + pattern
	}
	if pattern == "" {
		return node.Text + "\n\n" + context
	}
	return node.Text + "\n\n" + context + "\n\n" + pattern
}
