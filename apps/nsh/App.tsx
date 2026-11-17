import { View, mount } from 'nsh'
import { NavStack } from 'nsh/base'
import { currentWindow } from 'nsh/desktop'
import { nav } from './nav'
import { ReviewPage } from './pages/Review'
import { Workbench } from './pages/Workbench'

function App() {
  currentWindow().set({ titleBar: { style: 'hidden', height: 56 } })
  return (
    <View class="flex-1 bg-background">
      <NavStack state={nav} class="flex-1">
        {route =>
          route.name === 'review' ? <ReviewPage id={route.id} /> : <Workbench />
        }
      </NavStack>
    </View>
  )
}

mount(App)
