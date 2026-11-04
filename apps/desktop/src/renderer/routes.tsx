import { Route } from 'react-router'

import { Router } from 'lib/electron-router-dom'

import { MainScreen } from './screens/main'
import { SettingsScreen } from './screens/settings'
import { SubtitleReviewScreen } from './screens/subtitle-review'

export function AppRoutes() {
  return (
    <Router
      main={
        <>
          <Route path="/" element={<MainScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route
            path="/subtitle-review/:taskId"
            element={<SubtitleReviewScreen />}
          />
        </>
      }
    />
  )
}
