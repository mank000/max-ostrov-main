package moderation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	maxbot "github.com/max-messenger/max-bot-api-client-go/v2"
	"github.com/max-messenger/max-bot-api-client-go/v2/model"
)

type BotWorker struct {
	publicURL   string
	service     *Service
	sender      *MAXSender
	logger      *slog.Logger
	botID       int64
	botUsername string
	ownerID     int64
}

func NewBotWorker(service *Service, token string, ownerID int64, logger *slog.Logger) *BotWorker {
	sender := NewMAXSender(token)
	if service == nil || sender == nil {
		return nil
	}
	return &BotWorker{
		service: service,
		sender:  sender,
		ownerID: ownerID,
		logger:  logger,
	}
}

// Ссылки должны вести в эту установку, а не на сервер автора исходников.
func (w *BotWorker) WithPublicURL(value string) *BotWorker {
	if w != nil {
		w.publicURL = value
	}
	return w
}

func (w *BotWorker) Run(ctx context.Context) {
	if w == nil {
		return
	}
	var marker int64
	connected := false
	for ctx.Err() == nil {
		if w.botID == 0 {
			infoCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			info, err := w.sender.api.Bots.GetMyInfo(infoCtx)
			cancel()
			if err == nil {
				w.botID = info.UserID
				w.botUsername = strings.TrimPrefix(strings.TrimSpace(info.Username), "@")
			} else if ctx.Err() == nil {
				w.logger.Warn("MAX bot identity unavailable", "error", err)
			}
		}
		updates, nextMarker, err := w.sender.api.Subscriptions.GetUpdates(ctx, marker)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			w.logger.Warn("MAX moderation bot polling failed", "error", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
			continue
		}
		if !connected {
			w.logger.Info("MAX bot polling connected")
			connected = true
		}
		marker = nextMarker
		for _, update := range updates {
			userID, command, messageID, ok := botInput(update)
			if !ok {
				continue
			}
			reply := ""
			if update.Message != nil && len(update.Message.Body.Attachments) > 0 {
				photoToken := ""
				for _, attachment := range update.Message.Body.Attachments {
					if attachment.Type == model.AttachImage {
						photoToken = attachment.Payload.Token
						break
					}
				}
				if photoToken == "" {
					reply = "Поддержка принимает текст и фотографии. Отправьте сообщение без других вложений."
				} else {
					reply = w.handleSupportPhoto(ctx, userID, command, messageID, photoToken)
				}
			} else {
				reply = w.handle(ctx, userID, command, messageID)
			}
			if reply == "" {
				continue
			}
			response := botResponse(userID, command, reply, w.botID, w.publicURL)
			if _, err := w.sender.api.Messages.Send(ctx, response); err != nil {
				w.logger.Warn("MAX moderation bot reply failed", "error", err)
			}
		}
		w.flushSupport(ctx)
		if len(updates) == 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}
}

func (w *BotWorker) flushSupport(ctx context.Context) {
	for range 5 {
		delivery, err := w.service.ClaimSupportDelivery(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		if err != nil {
			w.logger.Warn("MAX support delivery claim failed", "error", err)
			return
		}
		sendCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		err = w.sender.SendSupportMessage(sendCtx, delivery.RecipientID, delivery.Text(), delivery.PhotoToken)
		cancel()
		if err != nil {
			w.logger.Warn("MAX support delivery failed", "thread_id", delivery.ThreadID, "error", err)
			continue
		}
		if err := w.service.MarkSupportDelivery(ctx, delivery.ID); err != nil {
			w.logger.Warn("MAX support delivery acknowledgment failed", "error", err)
		}
	}
}

func (w *BotWorker) handleSupportPhoto(ctx context.Context, maxID int64, caption, messageID, token string) string {
	parts := strings.Fields(caption)
	if len(parts) > 0 && botCommand(caption) == "/reply" {
		if len(parts) < 2 {
			return "Формат подписи к фото: /reply <номер> [текст]"
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return "Некорректный номер обращения."
		}
		if _, err = w.supportPrincipal(ctx, maxID); err != nil {
			return "Доступ к поддержке не назначен."
		}
		body := strings.TrimSpace(strings.Join(parts[2:], " "))
		if body == "" {
			body = "Фото"
		}
		err = w.service.ReplySupportMedia(ctx, id, maxID, fmt.Sprintf("staff:%d:%s", maxID, messageID), body, token, w.sender.SendSupportMessage)
		if err != nil {
			return "Фото не отправлено. Проверьте номер обращения и повторите попытку."
		}
		return "Фото отправлено."
	}
	if _, err := w.supportPrincipal(ctx, maxID); err == nil {
		return "Чтобы ответить фото, добавьте подпись: /reply <номер> [текст]."
	}
	body := strings.TrimSpace(caption)
	if body == "" {
		body = "Фото"
	}
	id, _, err := w.service.SubmitSupport(ctx, maxID, messageID, body, SupportSubmission{
		OwnerMAXID: w.ownerID,
		PhotoToken: token,
	})
	if errors.Is(err, ErrSupportLimit) {
		return "Слишком много сообщений. Подождите минуту и попробуйте снова."
	}
	if err != nil {
		return "Фото не удалось сохранить. Повторите попытку."
	}
	return fmt.Sprintf("Фото добавлено к обращению #%d.", id)
}

func botInput(update model.Update) (int64, string, string, bool) {
	if update.UpdateType == model.UpdateBotStarted {
		user := update.GetUser()
		if update.IsChannel || user.UserID <= 0 || user.IsBot {
			return 0, "", "", false
		}
		return user.UserID, "/start", update.MessageID, true
	}
	if update.UpdateType != model.UpdateMessageCreated || update.Message == nil {
		return 0, "", "", false
	}
	message := update.GetMessage()
	if message.Recipient.ChatType != model.ChatTypeDialog || message.Sender.UserID <= 0 || message.Sender.IsBot {
		return 0, "", "", false
	}
	messageID := message.Body.Mid
	if messageID == "" {
		messageID = update.MessageID
	}
	return message.Sender.UserID, message.Body.Text, messageID, true
}

func botResponse(userID int64, raw, reply string, botID int64, publicURL string) *maxbot.Message {
	response := maxbot.NewMessage().SetUser(userID).SetText(reply)
	if command := botCommand(raw); command == "/start" || command == "/about" || command == "/help" {
		keyboard := model.NewKeyboard()
		if botID > 0 {
			keyboard.AddRow().AddOpenApp("Открыть Кутёж", botID)
		} else if publicURL != "" {
			keyboard.AddRow().AddLink("Открыть сайт", publicURL)
		}
		response.AddKeyboard(keyboard)
	}
	return response
}

func (w *BotWorker) handle(ctx context.Context, maxID int64, raw, messageID string) string {
	parts := strings.Fields(raw)
	if len(parts) == 0 {
		return ""
	}
	command := botCommand(raw)
	switch command {
	case "/start":
		return "Привет! Это Кутёж — сервис для поиска мероприятий и знакомств через общие события.\n\n" + w.publicURL + "\n\nПодробнее о проекте: /about"
	case "/about":
		return "Кутёж помогает находить мероприятия рядом, планировать участие и знакомиться с людьми через события. На карте видны мероприятия, а не точное местоположение пользователей.\n\n" + w.publicURL
	case "/help":
		return "Поддержка Кутёжа здесь, в этом чате. Опишите проблему следующим сообщением или отправьте /support <текст>. Мы сохраним обращение и ответим здесь.\n\nЕсли проверка возраста по селфи уже прошла, но фото профиля не совпало или синяя галочка не появилась, напишите об этом и при необходимости отправьте актуальное фото. Модератор сможет вручную сверить фото и выдать синюю галочку. Если проверка возраста не пройдена, сначала нужно пройти её в приложении. Документы, пароли и коды входа не присылайте.\n\nДругие команды: /start, /about, /invite, /id."
	case "/invite", "/ref":
		link, err := w.referralLink(ctx, maxID)
		if errors.Is(err, sql.ErrNoRows) {
			return "Сначала один раз откройте Кутёж через кнопку бота, затем повторите /invite."
		}
		if err != nil {
			return "Не удалось создать ссылку приглашения. Попробуйте ещё раз."
		}
		return "Приглашайте друзей в Кутёж. За каждого нового друга вы получите 150 монет, а друг — 50.\n\n" + link
	case "/id":
		return fmt.Sprintf("Ваш MAX ID: %d", maxID)
	}
	if command == "/support" || !strings.HasPrefix(command, "/") {
		body := raw
		if command == "/support" {
			body = strings.TrimSpace(strings.TrimPrefix(raw, parts[0]))
		}
		if body == "" {
			return "Опишите проблему после /support или отправьте её отдельным сообщением."
		}
		id, _, err := w.service.SubmitSupport(ctx, maxID, messageID, body, SupportSubmission{OwnerMAXID: w.ownerID})
		if errors.Is(err, ErrSupportLimit) {
			return "Слишком много сообщений. Подождите минуту и попробуйте снова."
		}
		if errors.Is(err, ErrInvalid) {
			return "Сообщение должно быть текстом не длиннее 2000 символов."
		}
		if err != nil {
			w.logger.Error("MAX support message failed", "error", err)
			return "Не удалось сохранить обращение. Повторите попытку."
		}
		return fmt.Sprintf("Обращение #%d получено. Ответ поддержки придёт в этот чат.", id)
	}
	principal, err := w.supportPrincipal(ctx, maxID)
	if err != nil {
		return "Доступ к модерации не назначен."
	}
	switch command {
	case "/tickets":
		threads, err := w.service.SupportInbox(ctx)
		if err != nil {
			return "Не удалось загрузить обращения."
		}
		if len(threads) == 0 {
			return "Открытых обращений нет."
		}
		var b strings.Builder
		b.WriteString("Обращения поддержки:\n")
		for _, thread := range threads {
			fmt.Fprintf(&b, "#%d · MAX %d · /ticket %d\n", thread.ID, thread.ProviderUserID, thread.ID)
		}
		return strings.TrimSpace(b.String())
	case "/ticket":
		if len(parts) != 2 {
			return "Формат: /ticket <номер>"
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return "Некорректный номер обращения."
		}
		thread, messages, err := w.service.SupportHistory(ctx, id)
		if err != nil {
			return "Обращение не найдено."
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Обращение #%d (%s):\n", id, thread.Status)
		for _, message := range messages {
			fmt.Fprintf(&b, "%s: %s\n", message.Sender, message.Body)
		}
		return strings.TrimSpace(b.String())
	case "/reply":
		if len(parts) < 3 {
			return "Формат: /reply <номер> <ответ>"
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return "Некорректный номер обращения."
		}
		operationID := fmt.Sprintf("staff:%d:%s", maxID, messageID)
		err = w.service.ReplySupport(ctx, id, maxID, operationID, strings.Join(parts[2:], " "), func(ctx context.Context, recipient int64, body string) error {
			_, err := w.sender.api.Messages.Send(ctx, maxbot.NewMessage().SetUser(recipient).SetText(body))
			return err
		})
		if errors.Is(err, ErrConflict) {
			return "Этот ответ уже обрабатывается. Проверьте историю обращения перед повторной отправкой."
		}
		if err != nil {
			w.logger.Warn("MAX support reply failed", "error", err)
			return "Ответ не отправлен. Проверьте обращение и повторите попытку."
		}
		return "Ответ отправлен."
	case "/close":
		if len(parts) != 2 {
			return "Формат: /close <номер>"
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return "Некорректный номер обращения."
		}
		if err = w.service.CloseSupport(ctx, id); err != nil {
			return "Обращение не найдено или уже закрыто."
		}
		return "Обращение закрыто. Новое сообщение пользователя откроет его снова."
	case "/modhelp":
		return "Поддержка: /tickets, /ticket <номер>, /reply <номер> <ответ>, /verify <номер> <full|age|none> <причина>, /close <номер>. Модерация: /queue, /report <id>, /decision <id> <действие> <версия> <причина>."
	case "/verify":
		if len(parts) < 4 {
			return "Формат: /verify <номер> <full|age|none> <причина>"
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return "Некорректный номер обращения."
		}
		if err := w.service.SetSupportVerification(ctx, id, principal, parts[2], strings.Join(parts[3:], " ")); err != nil {
			return "Решение не принято. Нужна пройденная проверка возраста, а для синей галочки — текущая аватарка и обоснование."
		}
		return "Решение записано. Галочка профиля обновлена."
	case "/queue":
		if principal.Role == "support_owner" {
			return "Доступ к жалобам не назначен."
		}
		reports, _, err := w.service.ListReports(ctx, "open", "", 0, 10)
		if err != nil {
			return "Не удалось загрузить очередь."
		}
		if len(reports) == 0 {
			return "Открытых жалоб нет."
		}
		var b strings.Builder
		b.WriteString("Открытые жалобы:\n")
		for _, report := range reports {
			fmt.Fprintf(&b, "#%d: %s №%d, версия %d\n", report.ID, botTargetLabel(report.TargetType), report.TargetID, report.Version)
		}
		return strings.TrimSpace(b.String())
	case "/report":
		if principal.Role == "support_owner" {
			return "Доступ к жалобам не назначен."
		}
		if len(parts) != 2 {
			return "Формат: /report <id>"
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return "Некорректный ID жалобы."
		}
		report, err := w.service.GetReport(ctx, id)
		if err != nil {
			return "Жалоба не найдена."
		}

		return fmt.Sprintf("Жалоба #%d: %s №%d; статус: %s; версия %d. Причина: %s", report.ID, botTargetLabel(report.TargetType), report.TargetID, botStatusLabel(report.Status), report.Version, report.Reason)
	case "/decision":
		if principal.Role == "support_owner" {
			return "Доступ к жалобам не назначен."
		}
		if len(parts) < 5 {
			return "Формат: /decision <id> <dismiss|hide|restore|suspend|unsuspend> <версия> <причина>"
		}
		id, errID := strconv.ParseInt(parts[1], 10, 64)
		version, errVersion := strconv.Atoi(parts[3])
		if errID != nil || errVersion != nil || id <= 0 || version <= 0 {
			return "Некорректный ID или версия."
		}
		report, err := w.service.Decide(ctx, principal.UserID, id, DecisionInput{
			Action: parts[2], Version: version, Reason: strings.Join(parts[4:], " "),
		})
		if errors.Is(err, ErrConflict) {
			return "Жалоба уже изменилась. Выполните /report ещё раз."
		}
		if err != nil {
			return "Решение не принято. Проверьте действие, роль и состояние объекта."
		}
		return fmt.Sprintf("Решение сохранено по жалобе #%d. Статус: %s; версия: %d.", report.ID, botStatusLabel(report.Status), report.Version)
	default:
		return "Неизвестная команда. Выполните /modhelp."
	}
}

func (w *BotWorker) referralLink(ctx context.Context, maxID int64) (string, error) {
	username := strings.TrimPrefix(strings.TrimSpace(w.botUsername), "@")
	if username == "" {
		return "", ErrUnavailable
	}
	var userID int64
	err := w.service.db.QueryRowContext(ctx, `
		SELECT
		    identity.user_id
		FROM user_identities identity
		    JOIN users account ON account.id = identity.user_id
		WHERE identity.provider = 'max'
		    AND identity.provider_user_id = $1
		    AND identity.status = 'verified'
		    AND account.moderation_suspended_at IS NULL
	`, maxID,
	).Scan(&userID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("https://max.ru/%s?startapp=ref_%d", username, userID), nil
}

func (w *BotWorker) supportPrincipal(ctx context.Context, maxID int64) (Principal, error) {
	principal, err := w.service.PrincipalForMAX(ctx, maxID)
	if err == nil {
		if maxID == w.ownerID {
			principal.SupportOwner = true
		}
		return principal, nil
	}
	if maxID == w.ownerID && w.ownerID > 0 {
		return w.service.SupportOwnerPrincipal(ctx, maxID)
	}
	return Principal{}, err
}

func botCommand(raw string) string {
	parts := strings.Fields(raw)
	if len(parts) == 0 {
		return ""
	}
	command, _, _ := strings.Cut(parts[0], "@")
	return command
}

func botTargetLabel(target TargetType) string {
	switch target {
	case TargetUser:
		return "пользователь"
	case TargetPost:
		return "публикация"
	case TargetEvent:
		return "мероприятие"
	case TargetComment:
		return "комментарий"
	default:
		return "объект"
	}
}

func botStatusLabel(status string) string {
	switch status {
	case "open":
		return "открыта"
	case "reviewed":
		return "рассмотрена"
	case "dismissed":
		return "отклонена"
	default:
		return "неизвестен"
	}
}
