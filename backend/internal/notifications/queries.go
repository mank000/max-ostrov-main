package notifications

import _ "embed"

//go:embed queries/enqueue_birthday_reminders.sql
var enqueueBirthdayRemindersSQL string

//go:embed queries/send_job.sql
var sendJobSQL string
