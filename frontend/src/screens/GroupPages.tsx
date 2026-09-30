import { StatePanel } from '../ui/components/BasicUI'
import { CreateGroup } from './groups/CreateGroup'
import { GroupDetail } from './groups/GroupDetail'
import { GroupIncoming } from './groups/GroupIncoming'
import { GroupInvites } from './groups/GroupInvites'
import { GroupList } from './groups/GroupList'
import { GroupManage } from './groups/GroupManage'
import { GroupMerge } from './groups/GroupMerge'
import { GroupRequests } from './groups/GroupRequests'
import type { ScreenProps } from './screen-types'

export function GroupPages(props: ScreenProps) {
  switch (props.route.view) {
    case 'groups':
      return <GroupList {...props} />
    case 'groupdetail':
      return <GroupDetail {...props} />
    case 'creategroup':
      return <CreateGroup {...props} />
    case 'grouprequests':
      return <GroupRequests {...props} />
    case 'groupinvites':
      return <GroupInvites {...props} />
    case 'groupincoming':
      return <GroupIncoming {...props} />
    case 'groupmerge':
      return <GroupMerge {...props} />
    case 'groupmanage':
      return <GroupManage {...props} />
    default:
      return <StatePanel title="Группа недоступна" />
  }
}

export default GroupPages
