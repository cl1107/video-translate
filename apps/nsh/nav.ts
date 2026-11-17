import { createNavStack } from 'nsh/base'

export type Route = { name: 'workbench' } | { name: 'review'; id: string }

export const nav = createNavStack<Route>([{ name: 'workbench' }])

export function pushReview(id: string) {
  if (nav.routes().some(route => route.name === 'review' && route.id === id))
    return
  nav.push({ name: 'review', id })
}
