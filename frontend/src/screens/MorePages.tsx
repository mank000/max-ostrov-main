import { lazy } from 'react'
import { Header, StatePanel } from '../ui/components/BasicUI'
import { CityScreen } from './CityScreen'

import { FiltersScreen } from './FiltersScreen'
import { FriendRequestsScreen, FriendSearchScreen } from './FriendPages'

import { MyEvents } from './MyEventsScreen'
import { Notifications } from './NotificationsScreen'
import { Photos } from './PhotosScreen'
import { EditPostScreen, PostActionsScreen, UserMenuScreen } from './PostPages'

import { Appearance, Blocked, Privacy, SettingsScreen } from './SettingsScreen'
import { HostMessage, ShareScreen } from './ShareScreen'
import { SupportScreen } from './SupportScreen'
import {
  EventInvitesScreen,
  LikersScreen,
  ParticipantsScreen,
  UserEventsScreen,
  UserFriendsScreen,
  UserProfileScreen,
} from './UserPages'
import './extras.css'
import { ScreenProps } from './screen-types'

const AdminScreen = lazy(() => import('./AdminScreen'))

const EventPages = lazy(() => import('./EventPages'))

const GroupPages = lazy(() => import('./GroupPages'))

const RewardsPages = lazy(() => import('./RewardsPages'))

export function MorePage(props: ScreenProps) {
  const { route, back, navigate } = props
  const socialProps = { ...props, id: route.id || 0 }
  switch (route.view) {
    case 'friendrequests':
      return <FriendRequestsScreen {...socialProps} />
    case 'friendsearch':
      return <FriendSearchScreen {...socialProps} />
    case 'userprofile':
      return <UserProfileScreen {...socialProps} />
    case 'userposts':
      return <UserProfileScreen {...socialProps} initialTab="posts" />
    case 'userevents':
      return <UserEventsScreen {...socialProps} />
    case 'userfriends':
      return <UserFriendsScreen {...socialProps} />
    case 'participants':
      return <ParticipantsScreen {...socialProps} />
    case 'eventinvites':
      return <EventInvitesScreen {...socialProps} />
    case 'likers':
      return <LikersScreen {...socialProps} />
    case 'postactions':
      return <PostActionsScreen {...socialProps} />
    case 'editpost':
      return <EditPostScreen {...socialProps} />
    case 'usermenu':
      return <UserMenuScreen {...socialProps} />
    case 'city':
      return <CityScreen {...props} />
    case 'filters':
      return <FiltersScreen {...props} />
    case 'myevents':
      return <MyEvents {...props} view="upcoming" />
    case 'savedevents':
      return <MyEvents {...props} view="saved" />
    case 'admin':
      return <AdminScreen {...props} />
    case 'settings':
      return <SettingsScreen {...props} />
    case 'appearance':
      return <Appearance {...props} />
    case 'privacy':
      return <Privacy {...props} />
    case 'blocked':
      return <Blocked {...props} />
    case 'notifications':
      return <Notifications {...props} />
    case 'support':
      return <SupportScreen {...props} />
    case 'profilephotos':
      return <Photos {...props} />
    case 'share':
      return <ShareScreen {...props} />
    case 'hostmessage':
      return <HostMessage {...props} />
    default:
      if (
        [
          'groups',
          'groupdetail',
          'creategroup',
          'groupmanage',
          'grouprequests',
          'groupinvites',
          'groupincoming',
          'groupmerge',
        ].includes(route.view)
      )
        return <GroupPages {...props} />
      if (
        [
          'rewards',
          'store',
          'purchase',
          'boostevent',
          'transactions',
          'gifts',
          'usergifts',
          'sendgift',
        ].includes(route.view)
      )
        return <RewardsPages {...props} />
      if (
        [
          'attendance',
          'attendanceadmin',
          'ticket',
          'eventedit',
          'eventmanage',
          'eventsearch',
          'globe',
          'mapevent',
          'mapcluster',
        ].includes(route.view)
      )
        return <EventPages {...props} />
      return (
        <>
          <Header title="Раздел" back={back} />
          <StatePanel title="Раздел недоступен" action="Назад" onAction={() => navigate('feed')} />
        </>
      )
  }
}

export default MorePage
