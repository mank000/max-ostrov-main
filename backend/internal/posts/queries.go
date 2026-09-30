package posts

import _ "embed"

//go:embed queries/list_comments.sql
var listCommentsSQL string
