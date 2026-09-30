import { StatePanel } from '../ui/components/BasicUI'
import type { ScreenProps } from './screen-types'
import { Rewards } from './rewards/RewardsOverview'
import { Store, Purchase } from './rewards/StoreScreens'
import { Transactions } from './rewards/TransactionsScreen'
import { Gifts } from './rewards/GiftsScreen'
import { SendGift } from './rewards/SendGiftScreen'
import { BoostEvent } from './rewards/BoostEventScreen'

export function RewardsPages(props: ScreenProps) {
  switch (props.route.view) {
    case 'rewards':
      return <Rewards {...props} />
    case 'store':
      return <Store {...props} />
    case 'purchase':
      return <Purchase {...props} />
    case 'transactions':
      return <Transactions {...props} />
    case 'gifts':
    case 'usergifts':
      return <Gifts {...props} />
    case 'sendgift':
      return <SendGift {...props} />
    case 'boostevent':
      return <BoostEvent {...props} />
    default:
      return <StatePanel title="Раздел недоступен" />
  }
}

export default RewardsPages
