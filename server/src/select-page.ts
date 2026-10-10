/**
 * 考前选语言页（GET /select 直接返回本 HTML，无需构建）。
 * 学生用 姓名 + 手机号 选择 C / Python，每人仅一次，提交后锁定不可更改。
 */
export const SELECT_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LinExam · 考试语言选择</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f1f5f9; margin: 0; padding: 24px 16px; color: #1e293b; }
  .card { max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 28px 24px; box-shadow: 0 4px 24px rgba(15,23,42,.08); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #64748b; margin-bottom: 20px; }
  label { display: block; font-size: 13px; color: #475569; margin: 14px 0 6px; }
  input[type=text], input[type=tel] { width: 100%; height: 46px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0 12px; font-size: 15px; outline: none; }
  input:focus { border-color: #0f172a; }
  .langs { display: flex; gap: 12px; margin-top: 6px; }
  .lang { flex: 1; border: 2px solid #e2e8f0; border-radius: 12px; padding: 14px 0; text-align: center; font-size: 16px; font-weight: 700; cursor: pointer; user-select: none; }
  .lang small { display: block; font-size: 12px; font-weight: 400; color: #64748b; margin-top: 2px; }
  .lang.picked { border-color: #0f172a; background: #f8fafc; }
  button { width: 100%; height: 48px; margin-top: 22px; border: none; border-radius: 10px; background: #0f172a; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; }
  .warn { margin-top: 14px; font-size: 12px; color: #b45309; background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; }
  .msg { margin-top: 14px; font-size: 14px; border-radius: 8px; padding: 10px 12px; display: none; }
  .msg.ok { display: block; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
  .msg.err { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
</style>
</head>
<body>
<div class="card">
  <h1>考试语言选择</h1>
  <div class="sub">LinExam · 请输入报名时的姓名与手机号</div>
  <label>姓名</label>
  <input id="name" type="text" placeholder="请输入姓名" autocomplete="off">
  <label>手机号</label>
  <input id="phone" type="tel" placeholder="请输入手机号" autocomplete="off">
  <label>考试语言</label>
  <div class="langs">
    <div class="lang" data-lang="c">C<small>gcc 编译</small></div>
    <div class="lang" data-lang="python">Python<small>python3 运行</small></div>
  </div>
  <div class="warn">每人只能选择一次，提交后不可更改，请谨慎选择。</div>
  <button id="submit">确认选择</button>
  <div id="msg" class="msg"></div>
</div>
<script>
  let picked = '';
  document.querySelectorAll('.lang').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.lang').forEach(x => x.classList.remove('picked'));
      el.classList.add('picked');
      picked = el.dataset.lang;
    });
  });
  const msg = document.getElementById('msg');
  function show(text, ok) {
    msg.className = 'msg ' + (ok ? 'ok' : 'err');
    msg.textContent = text;
  }
  document.getElementById('submit').addEventListener('click', async (e) => {
    const btn = e.target;
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    if (!name) return show('请输入姓名', false);
    if (!phone) return show('请输入手机号', false);
    if (!picked) return show('请选择考试语言（C 或 Python）', false);
    btn.disabled = true;
    try {
      const resp = await fetch('/api/select-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, studentId: phone, language: picked }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        show('选择成功：' + (data.language === 'python' ? 'Python' : 'C') + '，请前往考试端登录。', true);
      } else {
        show(data.error || '选择失败，请重试', false);
      }
    } catch {
      show('无法连接服务器，请稍后重试', false);
    } finally {
      btn.disabled = false;
    }
  });
</script>
</body>
</html>`
