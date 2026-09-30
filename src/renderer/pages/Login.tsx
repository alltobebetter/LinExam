import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import TitleBar from '../components/TitleBar'
import Modal from '../components/Modal'
import electronIcon from '../assets/icons/electron.svg'
import reactIcon from '../assets/icons/react.svg'
import tsIcon from '../assets/icons/typescript.svg'
import tailwindIcon from '../assets/icons/tailwindcss.svg'
import viteIcon from '../assets/icons/vite.svg'
const techStack = [
  { name: 'Electron', icon: electronIcon },
  { name: 'React', icon: reactIcon },
  { name: 'TypeScript', icon: tsIcon },
  { name: 'Tailwind CSS', icon: tailwindIcon },
  { name: 'Vite', icon: viteIcon },
]

/* ── 图标输入框 ── */
function IconInput({
  value,
  onChange,
  label,
  icon,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  label: string
  icon: React.ReactNode
  type?: string
}) {
  const [focused, setFocused] = useState(false)
  const active = focused || value.length > 0

  return (
    <div className="relative">
      {/* 标签 */}
      <label
        className={`absolute left-12 transition-all duration-200 pointer-events-none ${
          active
            ? 'top-[7px] text-[11px] text-slate-400 dark:text-slate-500 font-medium'
            : 'top-1/2 -translate-y-1/2 text-[15px] text-slate-400 dark:text-slate-500'
        }`}
      >
        {label}
      </label>

      {/* 图标 */}
      <div
        className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
          focused ? 'text-slate-800 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600'
        }`}
      >
        {icon}
      </div>

      {/* 输入框 */}
      <input
        type={type}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full h-[54px] pl-12 pr-4 pt-[18px] pb-[2px] text-[15px] text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 rounded-xl outline-none border transition-all duration-200 ${
          focused
            ? 'border-slate-800 dark:border-slate-100 bg-white dark:bg-slate-800 ring-4 ring-slate-800/10 dark:ring-slate-100/10'
            : 'border-transparent dark:border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-100/80 dark:hover:bg-slate-700/50'
        }`}
      />
    </div>
  )
}

/* ── 图标 SVG ── */
const userIcon = (
  <svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const idCardIcon = (
  <svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2.5" />
    <circle cx="8" cy="12" r="2" />
    <path d="M14 11h4M14 14h3" />
  </svg>
)

const globeIcon = (
  <svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

/* ── 服务器地址的 localStorage 键 ── */
const SERVER_URL_KEY = 'linexam-server-url'

/** 不预填默认值：考试时由监考老师告知地址；填过一次后下次自动带出 */
function loadSavedServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_URL_KEY) || ''
  } catch {
    return ''
  }
}

/* ── 登录页 ── */
export default function Login() {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [serverUrl, setServerUrl] = useState(loadSavedServerUrl)
  const [loading, setLoading] = useState(false)
  const [modalType, setModalType] = useState<'terms' | 'privacy' | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return

    if (!name.trim()) {
      toast.show('请输入姓名', 'warning')
      return
    }
    if (!studentId.trim()) {
      toast.show('请输入学号', 'warning')
      return
    }
    if (!serverUrl.trim()) {
      toast.show('请填写考试服务器地址', 'warning')
      return
    }

    setLoading(true)
    try {
      // 在线验证登录（服务端地址由登录页传入，主进程校验题库指纹）
      const result = await window.exampower?.login(name.trim(), studentId.trim(), serverUrl.trim())

      if (!result?.ok) {
        toast.show(result?.error || '登录失败，请重试', 'error')
        return
      }

      // 登录成功后记住服务器地址，下次自动带出
      try {
        localStorage.setItem(SERVER_URL_KEY, serverUrl.trim())
      } catch { /* 忽略存储失败 */ }

      // 启动防作弊监控
      try {
        const mon = await window.exampower?.startMonitoring(studentId.trim(), name.trim())
        if (!mon?.ok) {
          toast.show('启动监控失败，请重试', 'error')
          return
        }
      } catch {
        toast.show('启动监控失败，请重试', 'error')
        return
      }

      toast.show('登录成功，欢迎进入考试', 'success')
      navigate('/exam')
    } catch {
      toast.show('登录失败，请重试', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-slate-950">
      <TitleBar />
      <div className="flex flex-1">
        {/* ── 左侧品牌区 ── */}
        <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden bg-slate-100 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        <div className="relative z-10">
          <h1 className="text-[44px] font-bold tracking-tight text-slate-900 dark:text-white">LinExam</h1>
          <p className="mt-2 text-[15px] text-slate-400 dark:text-white/40 tracking-[3px]">ONLINE EXAM</p>
        </div>

        {/* 技术栈图标 */}
        <div className="relative z-10">
          <p className="text-[13px] text-slate-400 dark:text-white/30 tracking-wide mb-5">POWERED BY</p>
          <div className="flex items-center gap-5 flex-wrap">
            {techStack.map((tech) => (
              <div key={tech.name} className="flex items-center gap-2 group">
                <img
                  src={tech.icon}
                  alt={tech.name}
                  className="w-7 h-7 opacity-60 dark:opacity-80 transition-opacity group-hover:opacity-100"
                />
                <span className="text-[14px] text-slate-500 dark:text-white/60 transition-colors group-hover:text-slate-800 dark:group-hover:text-white/90">
                  {tech.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* GitHub 开源 */}
        <div className="relative z-10 flex items-center justify-between">
          <a
            href="https://github.com/alltobebetter/LinExam"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white transition-colors group"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 transition-opacity opacity-60 dark:opacity-70 group-hover:opacity-100" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
            <span className="text-[14px]">alltobebetter/LinExam</span>
          </a>
          <span className="text-[13px] text-slate-400 dark:text-white/30">© 2026 LinExam</span>
        </div>
      </div>

      {/* ── 右侧表单区 ── */}
      <div className="flex-1 flex items-center justify-center px-8 sm:px-12 bg-white dark:bg-slate-950">
        <div className="w-full max-w-[380px]">
          {/* 小屏 logo */}
          <div className="lg:hidden mb-12 text-center">
            <h1 className="text-[36px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
              LinExam
            </h1>
          </div>

          {/* 标题 */}
          <div className="mb-8">
            <h2 className="text-[24px] font-bold text-slate-800 dark:text-slate-100">欢迎登录</h2>
            <p className="mt-2 text-[14px] text-slate-400 dark:text-slate-500">请输入您的信息以进入考试</p>
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <IconInput
              value={name}
              onChange={setName}
              label="姓名"
              icon={userIcon}
            />

            <IconInput
              value={studentId}
              onChange={setStudentId}
              label="学号"
              icon={idCardIcon}
            />

            {/* 服务器地址：默认上次填写的（或本机调试地址），部署后改为考试服务器 */}
            <IconInput
              value={serverUrl}
              onChange={setServerUrl}
              label="考试服务器地址"
              icon={globeIcon}
            />

            {/* 按钮 */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[50px] text-[15px] font-semibold text-white rounded-xl tracking-wide bg-slate-900 dark:bg-slate-100 dark:text-slate-900 transition-all duration-200 hover:bg-slate-800 dark:hover:bg-white hover:shadow-lg hover:shadow-slate-900/20 dark:hover:shadow-slate-100/10 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? '正在进入…' : '进入考试'}
              </button>
            </div>
          </form>

          {/* 隐私协议 */}
          <p className="mt-6 text-center text-[12px] text-slate-400 dark:text-slate-500 leading-relaxed">
            登录即代表您同意
            <a onClick={() => setModalType('terms')} className="text-slate-900 dark:text-slate-100 font-medium mx-0.5 cursor-pointer hover:underline">《用户协议》</a>
            与
            <a onClick={() => setModalType('privacy')} className="text-slate-900 dark:text-slate-100 font-medium mx-0.5 cursor-pointer hover:underline">《隐私政策》</a>
          </p>
        </div>
        </div>
      </div>

      {/* ── 弹窗 ── */}
      <Modal
        open={modalType === 'terms'}
        onClose={() => setModalType(null)}
        title="用户协议"
      >
        <div className="space-y-4 text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">一、服务说明</h3>
            <p>LinExam 是一款基于 Electron 构建的在线考试平台（以下简称「本平台」）。本平台为用户提供在线编程考试、代码提交、自动评测等服务。用户在使用本平台前，请仔细阅读并同意本协议全部内容。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">二、用户注册与登录</h3>
            <p>用户需使用真实姓名和学号登录本平台。用户应确保所提供的信息真实、准确，因提供虚假信息所导致的一切后果由用户自行承担。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">三、用户行为规范</h3>
            <p>用户在使用本平台时，应遵守以下规范：</p>
            <ul className="ml-4 space-y-1 mt-2">
              <li>· 不得以任何方式作弊，包括但不限于抄袭、传递答案、使用违规工具等；</li>
              <li>· 不得对本平台进行逆向工程、反编译或反汇编；</li>
              <li>· 不得利用本平台传播违法、有害信息；</li>
              <li>· 不得试图破坏本平台的安全系统或干扰其他用户的正常使用。</li>
            </ul>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">四、知识产权</h3>
            <p>本平台的软件代码、界面设计、题目内容等知识产权均归本平台所有。用户在考试过程中提交的代码，本平台有权用于评测、存档和学术研究目的。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">五、免责声明</h3>
            <p>本平台不对考试结果的准确性作任何担保。因网络故障、系统维护等原因导致的服务中断，本平台不承担责任。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">六、协议变更</h3>
            <p>本平台有权根据需要修改本协议内容，修改后的协议自公布之日起生效。用户继续使用本平台即视为同意修改后的协议。</p>
          </section>
          <p className="text-[12px] text-slate-400 dark:text-slate-500 pt-2">最后更新：2026 年 7 月 13 日</p>
        </div>
      </Modal>

      <Modal
        open={modalType === 'privacy'}
        onClose={() => setModalType(null)}
        title="隐私政策"
      >
        <div className="space-y-4 text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">一、信息收集</h3>
            <p>本平台在您使用过程中会收集以下信息：</p>
            <ul className="ml-4 space-y-1 mt-2">
              <li>· <span className="font-medium">姓名与学号</span>：用于身份验证和考试记录；</li>
              <li>· <span className="font-medium">代码提交记录</span>：用于评测和存档；</li>
              <li>· <span className="font-medium">设备信息</span>：包括操作系统类型，用于兼容性保障。</li>
            </ul>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">二、信息使用</h3>
            <p>本平台收集的信息仅用于以下目的：</p>
            <ul className="ml-4 space-y-1 mt-2">
              <li>· 提供在线考试及评测服务；</li>
              <li>· 生成考试成绩和评测报告；</li>
              <li>· 改进平台功能和用户体验。</li>
            </ul>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">三、信息保护</h3>
            <p>本平台采取严格的技术措施保护您的个人信息，包括数据加密存储、访问权限控制等。未经您的同意，本平台不会向任何第三方披露您的个人信息。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">四、信息存储与销毁</h3>
            <p>您的考试数据将在考试结束后保留一学期用于成绩复核，之后将自动销毁。您有权随时要求删除您的个人信息。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">五、Cookie 使用</h3>
            <p>本平台仅在本地存储主题偏好（如暗色模式设置），不使用 Cookie 进行用户追踪。</p>
          </section>
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2">六、用户权利</h3>
            <p>您有权查看、更正或删除您的个人信息。如有需要，请联系平台管理员。</p>
          </section>
          <p className="text-[12px] text-slate-400 dark:text-slate-500 pt-2">最后更新：2026 年 7 月 13 日</p>
        </div>
      </Modal>
    </div>
  )
}
