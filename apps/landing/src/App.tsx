import { HomePage } from './pages/HomePage'
import { DocsPage } from './pages/DocsPage'
import { useRouter } from './router'

export function App() {
  const { route } = useRouter()

  if (route === 'docs') {
    return <DocsPage />
  }

  return <HomePage />
}
