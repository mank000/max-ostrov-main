package games

type LifeMilestone struct {
	ID          string `json:"id"`
	Stage       int    `json:"stage"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Current     int64  `json:"current"`
	Target      int64  `json:"target"`
	Done        bool   `json:"done"`
}

func lifeNetWorth(st LifeState) int64 {
	total := st.Cash + st.Finance.Savings - st.Debt
	for _, amount := range st.Finance.Portfolio {
		total += amount
	}
	if st.Company != nil {
		ownership := st.Company.Ownership
		if ownership <= 0 { ownership = 100 }
		total += st.Company.Valuation * int64(ownership) / 100
	}
	return total
}

func lifeMilestones(st LifeState) []LifeMilestone {
	var milestones []LifeMilestone
	add := func(id string, stage int, title, description string, current, target int64) {
		if current < 0 { current = 0 }
		milestones = append(milestones, LifeMilestone{
			ID:id, Stage:stage, Title:title, Description:description,
			Current:current, Target:target, Done:current >= target,
		})
	}
	portfolio := int64(0)
	for _, amount := range st.Finance.Portfolio { portfolio += amount }
	companyTier, companyStaff, companyBrand := int64(0), int64(0), int64(0)
	companyValue, companyMarkets, products, acquisitions := int64(0), int64(0), int64(0), int64(0)
	public := int64(0)
	if st.Company != nil {
		companyTier = int64(st.Company.Tier)
		companyStaff = int64(st.Company.Staff)
		companyBrand = int64(st.Company.Brand)
		companyValue = st.Company.Valuation
		companyMarkets = int64(len(st.Company.Regions))
		products = int64(len(st.Company.Products))
		acquisitions = int64(st.Company.Acquisitions)
		if st.Company.Public { public = 1 }
	}
	career := int64(0)
	salary := int64(0)
	if st.Career != nil {
		career = 1
		salary = st.Career.Salary
	}
	hasCar := int64(0)
	for _, id := range st.Lifestyle.Assets {
		if asset, ok := findLifeAsset(id); ok && asset.Category == "transport" {
			hasCar = 1
			break
		}
	}

	add("first_income", 1, "Первые деньги", "Заработать первые 1 000 ₽.", st.TotalEarned, 1_000)
	add("cash_5k", 1, "Первая подушка", "Держать 5 000 ₽ наличными.", st.Cash, 5_000)
	add("experience_5", 1, "Не новичок", "Получить 5 единиц опыта.", int64(st.Experience), 5)
	add("stable_needs", 1, "Быт под контролем", "Поднять сытость и энергию до устойчивого уровня.", int64(min(st.Hunger, st.Energy)), 60)

	add("college_fund", 2, "Деньги на учёбу", "Накопить стоимость первого образования.", st.Cash, 8_000)
	add("college", 2, "Первый диплом", "Закончить колледж.", int64(st.Education), 1)
	add("credential", 2, "Прикладной навык", "Получить первую профессиональную квалификацию.", int64(len(st.Lifestyle.Credentials)), 1)
	add("experience_15", 2, "Рабочий ритм", "Достичь 15 опыта.", int64(st.Experience), 15)

	add("career", 3, "Настоящая работа", "Получить первую постоянную должность.", career, 1)
	add("earned_100k", 3, "Первые 100 тысяч", "Заработать суммарно 100 000 ₽.", st.TotalEarned, 100_000)
	add("reserve_50k", 3, "Финансовая подушка", "Собрать 50 000 ₽ в резерве.", st.Finance.Savings, 50_000)
	add("contacts_10", 3, "Профессиональная сеть", "Набрать 10 деловых контактов.", int64(st.Network.ProfessionalContacts), 10)

	add("bachelor", 4, "Высшее образование", "Закончить бакалавриат.", int64(st.Education), 2)
	add("salary_150k", 4, "Сильная профессия", "Выйти на зарплату 150 000 ₽/мес.", salary, 150_000)
	add("portfolio", 4, "Инвестор", "Создать портфель минимум на 100 000 ₽.", portfolio, 100_000)
	add("net_million", 4, "Первый миллион", "Достичь личного капитала 1 млн ₽.", lifeNetWorth(st), 1_000_000)

	add("manager_skill", 5, "Учитесь руководить", "Прокачать управление до 40.", int64(st.Skills.Management), 40)
	add("contacts_30", 5, "Связи работают", "Достичь 30 профессиональных контактов.", int64(st.Network.ProfessionalContacts), 30)
	add("first_car", 5, "Мобильность", "Получить собственный транспорт.", hasCar, 1)
	add("home_2", 5, "Своё жильё", "Дойти минимум до собственной студии.", int64(max(st.Home, st.MaxHome)), 2)

	add("master", 6, "Управленческая база", "Закончить магистратуру.", int64(st.Education), 3)
	add("mba", 6, "Верхняя ступень образования", "Получить Executive MBA.", int64(st.Education), 4)
	add("net_10m", 6, "Капитал для риска", "Достичь состояния 10 млн ₽.", lifeNetWorth(st), 10_000_000)
	add("reputation_50", 6, "Имя на рынке", "Довести репутацию до 50.", int64(st.Reputation), 50)

	add("business", 7, "Основатель", "Открыть собственную компанию.", companyTier, 1)
	add("staff_10", 7, "Первая команда", "Вырастить штат до 10 человек.", companyStaff, 10)
	add("brand_20", 7, "Компания заметна", "Развить бренд до 20.", companyBrand, 20)
	add("product", 7, "Свой продукт", "Запустить первый продукт.", products, 1)

	add("tier_4", 8, "Национальный масштаб", "Довести компанию до 4 уровня.", companyTier, 4)
	add("staff_500", 8, "Сотни людей", "Вырастить штат до 500.", companyStaff, 500)
	add("valuation_1b", 8, "Компания-миллиардник", "Достичь стоимости 1 млрд ₽.", companyValue, 1_000_000_000)
	add("foreign_market", 8, "За пределами дома", "Работать минимум на трёх рынках.", companyMarkets, 3)
	add("acquisition", 8, "Первая M&A-сделка", "Поглотить другую компанию.", acquisitions, 1)

	add("tier_6", 9, "Международный холдинг", "Дойти до 6 уровня бизнеса.", companyTier, 6)
	add("valuation_10b", 9, "Десять миллиардов стоимости", "Довести компанию до оценки 10 млрд ₽.", companyValue, 10_000_000_000)
	add("ipo", 9, "Публичная компания", "Провести IPO.", public, 1)
	add("markets_5", 9, "Международная сеть", "Работать минимум на пяти рынках.", companyMarkets, 5)
	add("staff_10000", 9, "Десять тысяч сотрудников", "Вырастить штат до 10 000.", companyStaff, 10_000)
	add("tnc", 9, "Транснациональная корпорация", "Достичь 7 уровня компании.", companyTier, 7)
	add("valuation_100b", 9, "Корпорация мирового масштаба", "Достичь стоимости 100 млрд ₽.", companyValue, 100_000_000_000)

	return milestones
}
