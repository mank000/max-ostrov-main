package contentpolicy

// Only this evaluated model may emit automatic semantic community-policy actions.
// Its scores are not legal findings or calibrated probabilities of an offence.
const SafetyVersion = "c583df8efc63d3bb784bedbe9f2247e14506d245cc9eeef317a70454996727e5"

type safetyBlockRule struct {
	label     string
	category  string
	threshold float64
}

// Community-policy action thresholds for the evaluated V19 model.
// Scores are classifier signals, not calibrated probabilities or legal findings.
var safetyBlockRules = []safetyBlockRule{
	{label: "abuse_direct", category: "insult", threshold: 0.9975228905677795},
	{label: "violence_intent", category: "threat", threshold: 0.9955209493637085},
	{label: "hate_targeted", category: "hate", threshold: 0.95},
	{label: "extremism_endorsement", category: "extremism", threshold: 0.999},
	{label: "illicit_trade", category: "prohibited", threshold: 0.99},
	{label: "sexual_explicit_text", category: "sexual", threshold: 0.95},
}

func SafetyBlockCategories(scores map[string]float64) []string {
	categories := make([]string, 0, len(safetyBlockRules))
	for _, rule := range safetyBlockRules {
		if scores[rule.label] >= rule.threshold {
			categories = append(categories, rule.category)
		}
	}
	return categories
}

func SafetyCategory(label string) string {
	switch label {
	case "abuse_direct":
		return "insult"
	case "violence_intent":
		return "threat"
	case "hate_targeted":
		return "hate"
	case "extremism_endorsement":
		return "extremism"
	case "illicit_trade":
		return "prohibited"
	case "sexual_explicit_text":
		return "sexual"
	default:
		return ""
	}
}
