"""
KZStream для Windows — версия 2.0.

Что делает программа:
- Вход по email/нику и паролю аккаунта KZStream.
- Ловит уведомления Kaspi о входящих переводах и отправляет их на сервер KZStream —
  в эфире TikTok Live появляется алерт с озвучкой. Три способа подключения телефона:
    1) «Связь с телефоном» (Phone Link) — Android-телефон, уведомления приходят на ПК;
    2) приложение KZStream на Android — телефон отправляет донаты сам, ПК не обязателен;
    3) iPhone по Bluetooth — через «Связь с телефоном» для iPhone.
- Выполняет хоткеи при донатах (тариф Pro).
- Значок в трее, автозапуск с Windows, звук при донате, автообновление.

Запуск с ключом --selftest проверяет, что программа собрана целиком, и сразу выходит
(используется при сборке на GitHub).
"""
import asyncio
import ctypes
import io
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser

import requests

APP_NAME = 'KZStream'
VERSION = '2.1.0'
DEFAULT_SERVER = 'https://kzstream.onrender.com'
APP_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), APP_NAME)
CFG_PATH = os.path.join(APP_DIR, 'config.json')
IS_WIN = sys.platform == 'win32'
NO_WINDOW = 0x08000000 if IS_WIN else 0

MONEY = re.compile(r'\d[\d\s  ]*([.,]\d{1,2})?\s*(₸|тг|тенге|KZT)|(₸|KZT)\s*\d', re.I)
BANK_WORDS = ('kaspi', 'каспи', 'перевод', 'пополнен', 'поступ', 'зачисл', 'halyk', 'jusan', 'freedom', 'аударым', 'түсті')
PHONE_LINK_APPS = ('связь с телефоном', 'phone link', 'your phone', 'ваш телефон', 'телефонмен байланыс')

try:
    import keyboard
except Exception:  # pragma: no cover
    keyboard = None

try:
    from winsdk.windows.ui.notifications.management import (
        UserNotificationListener, UserNotificationListenerAccessStatus)
    from winsdk.windows.ui.notifications import NotificationKinds, KnownNotificationBindings
    HAS_WINSDK = True
except Exception:  # pragma: no cover
    HAS_WINSDK = False


def resource(name):
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def ver_tuple(v):
    return tuple(int(x) for x in re.findall(r'\d+', str(v))[:3]) or (0,)


# ---------------------------------------------------------------- настройки
def load_cfg():
    try:
        with open(CFG_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_cfg(cfg):
    os.makedirs(APP_DIR, exist_ok=True)
    tmp = CFG_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
    os.replace(tmp, CFG_PATH)


def set_autostart(on):
    if not IS_WIN:
        return False
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE)
        if on:
            if getattr(sys, 'frozen', False):
                cmd = f'"{sys.executable}" --minimized'
            else:
                cmd = f'"{sys.executable}" "{os.path.abspath(__file__)}" --minimized'
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
        return True
    except Exception:
        return False


def set_clipboard(text):
    """Копирование в буфер обмена Windows (юникод, без внешних программ)."""
    if not IS_WIN:
        return False
    from ctypes import wintypes
    k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
    k32.GlobalAlloc.restype = wintypes.HGLOBAL
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    data = text.encode('utf-16le') + b'\x00\x00'
    for _ in range(10):
        if u32.OpenClipboard(None):
            break
        time.sleep(0.05)
    else:
        return False
    try:
        u32.EmptyClipboard()
        h = k32.GlobalAlloc(0x0042, len(data))
        p = k32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k32.GlobalUnlock(h)
        u32.SetClipboardData(13, h)  # CF_UNICODETEXT
        return True
    finally:
        u32.CloseClipboard()


# ---------------------------------------------------------------- звук при донате (создаётся кодом)
def chime_wav():
    rate, dur = 22050, 0.55
    frames = bytearray()
    notes = [(1318.5, 0.0), (1760.0, 0.09), (2637.0, 0.18)]
    for i in range(int(rate * dur)):
        t = i / rate
        v = 0.0
        for f, start in notes:
            if t >= start:
                tt = t - start
                v += math.sin(2 * math.pi * f * tt) * math.exp(-tt * 7)
        frames += struct.pack('<h', int(max(-1, min(1, v * 0.28)) * 32767))
    head = b'RIFF' + struct.pack('<I', 36 + len(frames)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16)
    return head + b'data' + struct.pack('<I', len(frames)) + bytes(frames)


CHIME = chime_wav()


def play_chime():
    if not IS_WIN:
        return
    try:
        import winsound
        winsound.PlaySound(CHIME, winsound.SND_MEMORY | winsound.SND_NODEFAULT)
    except Exception:
        pass


def phone_link_running():
    if not IS_WIN:
        return False
    try:
        out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq PhoneExperienceHost.exe', '/NH'],
                             capture_output=True, text=True, timeout=6, creationflags=NO_WINDOW).stdout
        return 'PhoneExperienceHost' in out
    except Exception:
        return False


# ---------------------------------------------------------------- логика
class Api:
    """Методы, которые вызывает интерфейс (window.pywebview.api.*)."""

    def __init__(self):
        self.cfg = load_cfg()
        for k, v in (('server', DEFAULT_SERVER), ('only_banks', True), ('autostart', True), ('sound', True),
                     ('tray', True), ('method', 'phonelink')):
            self.cfg.setdefault(k, v)
        self.window = None
        self.tray = None
        self.running = False
        self.quitting = False
        self.hotkeys = []
        self.seen = set()
        self.notif_status = 'wait'
        self.last_phone_notif = 0
        self.last_kaspi = 0
        self.stream_ok = False
        self.feed = []
        self.update_info = None

    # --- связь с интерфейсом
    def push(self, kind, data):
        if self.window:
            try:
                self.window.evaluate_js(f'window.kz && kz.on({json.dumps(kind)}, {json.dumps(data, ensure_ascii=False)})')
            except Exception:
                pass

    def log(self, msg):
        self.push('log', {'t': time.strftime('%H:%M:%S'), 'm': msg})

    # --- методы для интерфейса
    def state(self):
        c = self.cfg
        return {'logged': bool(c.get('token')), 'nick': c.get('nick', ''), 'plan': c.get('plan', ''),
                'server': c['server'], 'only_banks': c['only_banks'], 'autostart': c['autostart'], 'sound': c['sound'],
                'tray': c['tray'], 'method': c['method'], 'notif': self.notif_status, 'winsdk': HAS_WINSDK,
                'version': VERSION, 'stream': self.stream_ok, 'update': self.update_info, 'feed': self.feed[:30]}

    def login(self, email, password, server=None):
        srv = (server or self.cfg['server']).strip().rstrip('/')
        try:
            r = requests.post(f'{srv}/api/app/login', json={'email': email, 'password': password}, timeout=75)
            j = r.json()
        except Exception as e:
            return {'ok': False, 'error': f'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз. ({e.__class__.__name__})'}
        if r.status_code != 200 or not j.get('ok'):
            return {'ok': False, 'error': j.get('error', 'Ошибка входа')}
        self.cfg.update(server=srv, token=j['token'], link=j['ingest'], nick=j['nick'], plan=j.get('plan', ''))
        save_cfg(self.cfg)
        set_autostart(self.cfg['autostart'])
        self.start()
        return {'ok': True, **self.state()}

    def logout(self):
        self.running = False
        for k in ('token', 'link', 'nick', 'plan'):
            self.cfg.pop(k, None)
        save_cfg(self.cfg)
        self.feed = []
        return self.state()

    def set_option(self, name, value):
        if name in ('only_banks', 'autostart', 'sound', 'tray'):
            self.cfg[name] = bool(value)
        elif name == 'method' and value in ('phonelink', 'android', 'iphone'):
            self.cfg[name] = value
        elif name == 'server' and str(value).startswith('http'):
            self.cfg[name] = str(value).strip().rstrip('/')
        save_cfg(self.cfg)
        if name == 'autostart':
            set_autostart(bool(value))
        return self.state()

    def me(self):
        try:
            r = requests.get(f"{self.cfg['server']}/api/app/me/{self.cfg.get('token', '')}", timeout=75)
            if r.status_code == 404:
                return {'expired': True}
            j = r.json()
            self.hotkeys = j.get('hotkeys', []) or []
            if j.get('plan'):
                self.cfg['plan'] = j['plan']
            if not self.feed and j.get('last'):
                self.feed = [{'name': d['name'], 'amount': d['amount'], 'message': d.get('message', ''), 't': d.get('done_at', 0)} for d in j['last']]
            j['feed'] = self.feed[:30]
            return j
        except Exception as e:
            return {'error': str(e)}

    def checks(self):
        """Проверки для раздела «Подключение»."""
        now = time.time()
        return {'notif': self.notif_status, 'winsdk': HAS_WINSDK, 'phone_link': phone_link_running(),
                'phone_seen': bool(self.last_phone_notif and now - self.last_phone_notif < 3600),
                'kaspi_seen': bool(self.last_kaspi and now - self.last_kaspi < 86400), 'stream': self.stream_ok}

    def test(self):
        code, j = self.post({'title': 'Kaspi.kz', 'text': 'Перевод 1 000 ₸ от Тест Т.\nПривет! Это тест из программы KZStream для Windows',
                             'key': f'wtest-{time.time()}'})
        if code == 200:
            self.log('Тестовый донат отправлен — смотрите алерт в эфире/превью')
        return {'ok': code == 200, 'error': j.get('error')}

    def test_hotkey(self, keys):
        if not keyboard:
            return {'ok': False, 'error': 'Хоткеи недоступны на этом компьютере'}
        try:
            time.sleep(1.5)  # успеть переключиться в нужное окно
            keyboard.send(keys)
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def copy(self, text):
        return set_clipboard(str(text))

    def open_url(self, url):
        webbrowser.open(url)

    def open_site(self, path='/app'):
        webbrowser.open(self.cfg['server'] + path)

    def open_notif_settings(self):
        if IS_WIN:
            os.startfile('ms-settings:privacy-notifications')

    def open_phone_link(self):
        if IS_WIN:
            try:
                os.startfile('ms-phone:')
            except Exception:
                webbrowser.open('ms-windows-store://pdp/?productid=9NMPJ99VJBWV')

    def open_bluetooth(self):
        if IS_WIN:
            os.startfile('ms-settings:bluetooth')

    def hide_to_tray(self):
        if self.window:
            self.window.hide()

    def quit(self):
        self.quitting = True
        self.running = False
        try:
            if self.tray:
                self.tray.stop()
        except Exception:
            pass
        if self.window:
            self.window.destroy()

    # --- обновления
    def check_update(self, silent=False):
        try:
            j = requests.get(f"{self.cfg['server']}/api/app/version", timeout=40).json()
            if ver_tuple(j.get('windows')) > ver_tuple(VERSION):
                self.update_info = {'version': j['windows'], 'url': j.get('url') or self.cfg['server'] + '/update/KZStream-Setup.exe', 'setup': j.get('setup'), 'notes': j.get('notes', '')}
                self.push('update', self.update_info)
                return self.update_info
            return {'none': True}
        except Exception as e:
            return {'error': str(e)}

    def do_update(self):
        """Скачивает новый установщик и тихо ставит его поверх, затем перезапускает программу."""
        if not self.update_info or not getattr(sys, 'frozen', False):
            return {'ok': False, 'error': 'Обновление работает в установленной программе KZStream'}
        try:
            setup = os.path.join(tempfile.gettempdir(), 'KZStream-Setup-new.exe')
            url = self.update_info.get('setup') or self.update_info['url']
            with requests.get(url, stream=True, timeout=(30, 300)) as r:
                r.raise_for_status()
                total, done = int(r.headers.get('content-length') or 0), 0
                with open(setup, 'wb') as f:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
                        done += len(chunk)
                        if total:
                            self.push('upd_progress', round(done * 100 / total))
            if os.path.getsize(setup) < 1_000_000:
                return {'ok': False, 'error': 'Файл обновления повреждён, попробуйте позже'}
            app_exe = sys.executable
            bat = os.path.join(tempfile.gettempdir(), 'kzstream_update.bat')
            with open(bat, 'w', encoding='cp866', errors='ignore') as f:
                f.write('@echo off\r\ntimeout /t 2 /nobreak >nul\r\n'
                        f'start "" /wait "{setup}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS\r\n'
                        f'start "" "{app_exe}" --after-update\r\ndel "{setup}"\r\ndel "%~f0"\r\n')
            subprocess.Popen(['cmd', '/c', bat], creationflags=NO_WINDOW | 0x00000008)
            threading.Timer(0.5, self.quit).start()
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    # --- работа
    def post(self, body):
        try:
            r = requests.post(self.cfg['link'], json=body, timeout=75)
            return r.status_code, r.json()
        except Exception as e:
            return 0, {'error': str(e)}

    def start(self):
        if self.running or not self.cfg.get('link'):
            return
        self.running = True
        threading.Thread(target=self.notif_thread, daemon=True).start()
        threading.Thread(target=self.events_thread, daemon=True).start()
        threading.Thread(target=lambda: (time.sleep(4), self.check_update(True)), daemon=True).start()
        self.log(f'Подключено к аккаунту {self.cfg.get("nick")}')

    def set_notif(self, st):
        self.notif_status = st
        self.push('notif', st)

    def notif_thread(self):
        if not HAS_WINSDK:
            self.set_notif('unsupported')
            return
        try:
            asyncio.run(self.notif_loop())
        except Exception as e:
            self.log(f'Ошибка уведомлений: {e}')
            self.set_notif('error')

    async def notif_loop(self):
        listener = UserNotificationListener.current
        try:
            status = await listener.request_access_async()
        except Exception:
            status = listener.get_access_status()
        if status != UserNotificationListenerAccessStatus.ALLOWED:
            self.set_notif('denied')
            self.log('Нет доступа к уведомлениям Windows — разрешите в настройках')
            while self.running and listener.get_access_status() != UserNotificationListenerAccessStatus.ALLOWED:
                await asyncio.sleep(3)
            if not self.running:
                return
        self.set_notif('ok')
        self.log('Жду переводы Kaspi…')
        first = True
        while self.running:
            try:
                notifs = await listener.get_notifications_async(NotificationKinds.TOAST)
                for n in notifs:
                    if n.id in self.seen:
                        continue
                    self.seen.add(n.id)
                    if not first:
                        self.handle(n)
                first = False
                if len(self.seen) > 5000:
                    self.seen = set(list(self.seen)[-1000:])
            except Exception as e:
                self.log(f'Ошибка чтения уведомлений: {e}')
                await asyncio.sleep(5)
            await asyncio.sleep(1)

    def handle(self, n):
        try:
            app = n.app_info.display_info.display_name or ''
        except Exception:
            app = ''
        try:
            binding = n.notification.visual.get_binding(KnownNotificationBindings.toast_generic)
            texts = [t.text for t in binding.get_text_elements()] if binding else []
        except Exception:
            texts = []
        if not texts:
            return
        if any(p in app.lower() for p in PHONE_LINK_APPS):
            self.last_phone_notif = time.time()
        title, text = texts[0], '\n'.join(texts[1:])
        full = f'{app}\n{title}\n{text}'
        if not MONEY.search(full):
            return
        low = full.lower()
        if self.cfg['only_banks'] and not any(k in low for k in BANK_WORDS):
            return
        if 'kaspi' in low or 'каспи' in low:
            self.last_kaspi = time.time()
        code, j = self.post({'title': title, 'text': text, 'package': app, 'key': f'win-{n.id}'})
        if code == 200 and j.get('donation'):
            d = j['donation']
            self.log(f'💸 Донат пойман: {d["name"]} — {d["amount"]} ₸')
        elif code == 200:
            self.log(f'Уведомление «{title[:40]}» — не похоже на входящий перевод, пропущено')
        else:
            self.log(f'Ошибка отправки: {j.get("error", code)}')

    def events_thread(self):
        while self.running:
            base, token = self.cfg['server'], self.cfg.get('token')
            try:
                with requests.get(f'{base}/api/w/{token}/stream', stream=True, timeout=(75, 90)) as r:
                    if r.status_code != 200:
                        raise RuntimeError(r.status_code)
                    self.stream_ok = True
                    self.push('stream', True)
                    event = None
                    for raw in r.iter_lines(decode_unicode=True):
                        if not self.running:
                            return
                        if not raw:
                            continue
                        if raw.startswith('event:'):
                            event = raw[6:].strip()
                        elif raw.startswith('data:') and event:
                            data = json.loads(raw[5:].strip())
                            if event == 'donation':
                                self.on_donation(data)
                            elif event == 'settings':
                                self.hotkeys = data.get('hotkeys', []) or []
                            event = None
            except Exception:
                pass
            if self.stream_ok:
                self.stream_ok = False
                self.push('stream', False)
            time.sleep(3)

    def on_donation(self, d):
        item = {'name': d.get('name', ''), 'amount': d.get('amount', 0), 'message': d.get('message', ''), 't': int(time.time() * 1000)}
        self.feed.insert(0, item)
        del self.feed[60:]
        self.push('donation', item)
        if self.cfg.get('sound'):
            threading.Thread(target=play_chime, daemon=True).start()
        self.fire_hotkeys(d.get('amount', 0))

    def fire_hotkeys(self, amount):
        for h in self.hotkeys:
            lo, hi = h.get('min', 0) or 0, h.get('max', 0) or 0
            if amount >= lo and (not hi or amount <= hi) and keyboard:
                try:
                    keyboard.send(h['keys'])
                    self.log(f'⌨ Хоткей {h["keys"]} ({amount} ₸)')
                except Exception as e:
                    self.log(f'Хоткей {h.get("keys")}: {e}')


# ---------------------------------------------------------------- трей
def make_tray(api):
    try:
        import pystray
        from PIL import Image
    except Exception:
        return None
    try:
        img = Image.open(resource('icon.ico'))
    except Exception:
        img = Image.new('RGB', (64, 64), (255, 59, 92))

    def show(icon=None, item=None):
        if api.window:
            api.window.show()
            try:
                api.window.restore()
            except Exception:
                pass

    menu = pystray.Menu(
        pystray.MenuItem('Открыть KZStream', show, default=True),
        pystray.MenuItem('Тестовый донат', lambda i, it: api.test()),
        pystray.MenuItem('Кабинет на сайте', lambda i, it: api.open_site('/app')),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem('Выход', lambda i, it: api.quit()),
    )
    return pystray.Icon(APP_NAME, img, 'KZStream — ловлю донаты Kaspi', menu)


def build_html():
    with open(resource('ui.html'), encoding='utf-8') as f:
        html = f.read()
    try:
        with open(resource('qrcode.js'), encoding='utf-8') as f:
            html = html.replace('/*QRCODE*/', f.read())
    except Exception:
        pass
    return html


def single_instance():
    if not IS_WIN:
        return True
    try:
        ctypes.windll.kernel32.CreateMutexW(None, False, 'Local\\KZStream_App_Mutex')
        if ctypes.windll.kernel32.GetLastError() == 183:  # уже запущено
            ctypes.windll.user32.MessageBoxW(None, 'KZStream уже запущен — значок в трее рядом с часами.', 'KZStream', 0x40)
            return False
    except Exception:
        pass
    return True


def selftest():
    """Проверка сборки: всё нужное внутри exe."""
    problems = []
    try:
        import webview  # noqa: F401
    except Exception as e:
        problems.append(f'webview: {e}')
    for name in ('ui.html', 'icon.ico', 'qrcode.js'):
        if not os.path.exists(resource(name)):
            problems.append(f'нет файла {name}')
    if IS_WIN and not HAS_WINSDK:
        problems.append('winsdk')
    if keyboard is None:
        problems.append('keyboard')
    try:
        import pystray  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception as e:
        problems.append(f'tray: {e}')
    if len(CHIME) < 10000:
        problems.append('chime')
    out = os.path.join(os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else __file__), 'selftest.txt')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('OK ' + VERSION if not problems else 'FAIL ' + '; '.join(problems))
    return 0 if not problems else 1


def smoketest(api, window):
    """Пробный запуск при сборке: окно открылось, интерфейс загрузился, трей создаётся. Снимок экрана — для проверки."""
    res = 'FAIL'
    try:
        for _ in range(60):
            time.sleep(0.5)
            try:
                r = window.evaluate_js("document.querySelector('#login:not(.hide), #app:not(.hide)') ? 'UI_OK ' + document.title + ' ' + !!window.qrcode : 'WAIT'")
            except Exception:
                r = 'WAIT'
            if r and str(r).startswith('UI_OK'):
                res = 'OK ' + str(r)
                break
        tray = make_tray(api)
        res += ' tray=' + ('ok' if tray else 'no')
        time.sleep(2)
        try:
            from PIL import ImageGrab
            ImageGrab.grab().save(os.path.join(os.path.dirname(sys.executable), 'smoke.png'))
        except Exception as e:
            res += f' (снимок: {e})'
    finally:
        with open(os.path.join(os.path.dirname(sys.executable), 'smoke.txt'), 'w', encoding='utf-8') as f:
            f.write(res)
        api.quitting = True
        window.destroy()


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    if '--smoketest' not in sys.argv and not single_instance():
        return
    import webview
    api = Api()
    if '--smoketest' in sys.argv:
        api.cfg = {'server': DEFAULT_SERVER, 'only_banks': True, 'autostart': False, 'sound': True, 'tray': True, 'method': 'phonelink'}
    html = build_html()
    start_hidden = '--minimized' in sys.argv
    window = webview.create_window('KZStream', html=html, js_api=api, width=1080, height=700,
                                   min_size=(900, 600), background_color='#07080D', hidden=start_hidden)
    api.window = window

    def on_closing():
        # крестик прячет программу в трей, чтобы донаты продолжали ловиться
        if api.cfg.get('tray') and api.tray and not api.quitting:
            window.hide()
            return False
        api.quitting = True
        api.running = False
        try:
            if api.tray:
                api.tray.stop()
        except Exception:
            pass
        return True

    window.events.closing += on_closing

    def on_ready():
        if '--smoketest' in sys.argv:
            return smoketest(api, window)
        api.tray = make_tray(api)
        if api.tray:
            api.tray.run_detached()
        if api.cfg.get('token'):
            api.start()
        if '--after-update' in sys.argv:
            api.log(f'Программа обновлена до версии {VERSION} ✓')

    webview.start(on_ready, private_mode=False)
    api.running = False


if __name__ == '__main__':
    main()
