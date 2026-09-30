import { Cell, Header, StatePanel } from '../ui/components/BasicUI'
import { AttendanceAdmin } from './AttendanceReviewScreen'
import { AttendanceScreen } from './AttendanceScreen'
import { EventEdit } from './EventEditScreen'
import { EventManage } from './EventManageScreen'
import { EventSearch } from './EventSearchScreen'
import type { ScreenProps } from './screen-types'

export function EventPages(props: ScreenProps) {
  switch (props.route.view) {
    case 'attendance':
      return <AttendanceScreen {...props} />
    case 'attendanceadmin':
      return <AttendanceAdmin {...props} />
    case 'eventmanage':
      return <EventManage {...props} />
    case 'eventedit':
      return <EventEdit {...props} />
    case 'eventsearch':
      return <EventSearch {...props} />
    case 'ticket':
      return (
        <>
          <Header title="Билет" back={props.back} />
          <StatePanel
            title="Билет у организатора"
            action="Открыть мероприятие"
            onAction={() => props.navigate('event', props.route.id)}
          />
        </>
      )
    case 'globe':
      return (
        <>
          <Header title="Города" back={props.back} />
          <div className="screen-scroll">
            <Cell icon="globe" title="Выбрать город" onClick={() => props.navigate('city')} />
          </div>
        </>
      )
    case 'mapevent':
    case 'mapcluster':
      return (
        <>
          <Header title="Мероприятия на карте" back={props.back} />
          <StatePanel
            title="Выберите мероприятие на карте"
            action="На карту"
            onAction={() => props.navigate('map')}
          />
        </>
      )
    default:
      return <StatePanel title="Мероприятие недоступно" />
  }
}

export default EventPages
