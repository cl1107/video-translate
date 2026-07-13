import { app } from 'electron'

export function makeAppWithSingleInstanceLock(fn: () => void) {
  const isPrimaryInstance = app.requestSingleInstanceLock()

  if (isPrimaryInstance) {
    fn()
  } else {
    app.quit()
  }
}
