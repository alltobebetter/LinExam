import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Exam from './pages/Exam'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/exam" element={<Exam />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
