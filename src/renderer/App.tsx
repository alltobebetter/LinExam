import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Exam from './pages/Exam'

function RequireAuth({ children }: { children: React.JSX.Element }) {
  const [state, setState] = useState<'checking' | 'ok' | 'fail'>('checking')
  useEffect(() => {
    let cancelled = false
    // 登录态以 IPC 可用+调用成功为准，空题表也放行（由 Exam 页展示空态），仅抛错/不可用才踢回
    if (!window.exampower?.getProblemList) {
      setState('fail')
      return
    }
    window.exampower.getProblemList().then(list => {
      if (cancelled) return
      setState(Array.isArray(list) ? 'ok' : 'fail')
    }).catch(() => {
      if (!cancelled) setState('fail')
    })
    return () => { cancelled = true }
  }, [])
  if (state === 'checking') {
    return <div className="flex items-center justify-center h-screen text-[13px] text-slate-400">加载中…</div>
  }
  if (state === 'fail') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/exam" element={<RequireAuth><Exam /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
