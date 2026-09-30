package social

import _ "embed"

//go:embed queries/list_birthday_friends.sql
var listBirthdayFriendsSQL string

//go:embed queries/list_friends.sql
var listFriendsSQL string

//go:embed queries/list_public_friends.sql
var listPublicFriendsSQL string
