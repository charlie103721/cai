import { Routes, Route } from 'react-router'
import { AppShell } from './components/AppShell'
import FeedPage from './pages/FeedPage'
import TopicsPage from './pages/TopicsPage'
import ChatsPage from './pages/ChatsPage'
import MePage from './pages/MePage'
import { ChatRoute } from './pages/Chat'
import Login from './pages/Login'
import Signup from './pages/Signup'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FeedPage />} />
        <Route path="/topics" element={<TopicsPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/chat/:conversationId" element={<ChatRoute />} />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
