"""
KZStream для Windows.
- Вход по email и паролю аккаунта KZStream.
- Читает уведомления Windows (Kaspi с телефона через «Связь с телефоном» / Phone Link)
  и отправляет входящие переводы на сервер — алерт с озвучкой появляется на стриме.
- Выполняет хоткеи при донатах (тариф Pro).
- Автозапуск вместе с Windows.
"""
import asyncio
import json
import os
import re
import sys
import threading
import time

import requests
import webview

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

APP_NAME = 'KZStream'
VERSION = '1.1'
DEFAULT_SERVER = 'https://kzstream.onrender.com'
APP_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), APP_NAME)
CFG_PATH = os.path.join(APP_DIR, 'config.json')
MONEY = re.compile(r'\d[\d\s  ]*([.,]\d{1,2})?\s*(₸|тг|тенге|KZT)|(₸|KZT)\s*\d', re.I)
BANK_WORDS = ('kaspi', 'каспи', 'перевод', 'пополнен', 'поступ', 'зачисл', 'halyk', 'jusan', 'freedom')


def load_cfg():
    try:
        with open(CFG_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_cfg(cfg):
    os.makedirs(APP_DIR, exist_ok=True)
    with open(CFG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False)


def set_autostart(on):
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE)
        if on:
            exe = sys.executable if getattr(sys, 'frozen', False) else f'"{sys.executable}" "{os.path.abspath(__file__)}"'
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{exe}" --minimized' if getattr(sys, 'frozen', False) else exe)
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
        return True
    except Exception:
        return False


class Api:
    """Методы, которые вызывает интерфейс (window.pywebview.api.*)."""

    def __init__(self):
        self.cfg = load_cfg()
        self.cfg.setdefault('server', DEFAULT_SERVER)
        self.cfg.setdefault('only_banks', True)
        self.cfg.setdefault('autostart', True)
        self.window = None
        self.running = False
        self.hotkeys = []
        self.seen = set()
        self.notif_status = 'wait'

    # ---------- связь с интерфейсом ----------
    def push(self, kind, data):
        if self.window:
            try:
                self.window.evaluate_js(f'window.kz && kz.on({json.dumps(kind)}, {json.dumps(data, ensure_ascii=False)})')
            except Exception:
                pass

    def log(self, msg):
        self.push('log', {'t': time.strftime('%H:%M:%S'), 'm': msg})

    # ---------- API для интерфейса ----------
    def state(self):
        return {'logged': bool(self.cfg.get('token')), 'nick': self.cfg.get('nick', ''), 'plan': self.cfg.get('plan', ''),
                'server': self.cfg['server'], 'only_banks': self.cfg['only_banks'], 'autostart': self.cfg['autostart'],
                'notif': self.notif_status, 'winsdk': HAS_WINSDK, 'version': VERSION}

    def login(self, email, password, server=None):
        srv = (server or self.cfg['server']).strip().rstrip('/')
        try:
            r = requests.post(f'{srv}/api/app/login', json={'email': email, 'password': password}, timeout=70)
            j = r.json()
        except Exception as e:
            return {'ok': False, 'error': f'Нет связи с сервером: {e}'}
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
        return self.state()

    def set_option(self, name, value):
        if name in ('only_banks', 'autostart'):
            self.cfg[name] = bool(value)
            save_cfg(self.cfg)
            if name == 'autostart':
                set_autostart(bool(value))
        return self.state()

    def me(self):
        try:
            r = requests.get(f"{self.cfg['server']}/api/app/me/{self.cfg.get('token', '')}", timeout=70)
            if r.status_code == 404:
                return {'expired': True}
            j = r.json()
            self.hotkeys = j.get('hotkeys', []) or []
            if j.get('plan'):
                self.cfg['plan'] = j['plan']
            return j
        except Exception as e:
            return {'error': str(e)}

    def test(self):
        code, j = self.post({'title': 'Kaspi.kz', 'text': 'Перевод 1 000 ₸ от Тест Т.\nПривет! Это тест из программы для Windows', 'key': f'wtest-{time.time()}'})
        return {'ok': code == 200, 'error': j.get('error')}

    def open_site(self, path='/app'):
        import webbrowser
        webbrowser.open(self.cfg['server'] + path)

    def open_notif_settings(self):
        os.startfile('ms-settings:privacy-notifications')

    def open_phone_link(self):
        os.startfile('ms-phone:')

    # ---------- работа ----------
    def post(self, body):
        try:
            r = requests.post(self.cfg['link'], json=body, timeout=70)
            return r.status_code, r.json()
        except Exception as e:
            return 0, {'error': str(e)}

    def start(self):
        if self.running or not self.cfg.get('link'):
            return
        self.running = True
        threading.Thread(target=self.notif_thread, daemon=True).start()
        threading.Thread(target=self.events_thread, daemon=True).start()
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
            self.log('Нет доступа к уведомлениям Windows')
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
                self.log(f'Ошибка чтения: {e}')
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
        title, text = texts[0], '\n'.join(texts[1:])
        full = f'{app}\n{title}\n{text}'
        if not MONEY.search(full):
            return
        if self.cfg['only_banks'] and not any(k in full.lower() for k in BANK_WORDS):
            return
        code, j = self.post({'title': title, 'text': text, 'package': app, 'key': f'win-{n.id}'})
        if code == 200 and j.get('donation'):
            d = j['donation']
            self.log(f'💸 {d["name"]} — {d["amount"]} ₸')
            self.push('donation', d)
        elif code != 200:
            self.log(f'Ошибка отправки: {j.get("error", code)}')

    def events_thread(self):
        base, token = self.cfg['server'], self.cfg['token']
        while self.running:
            try:
                with requests.get(f'{base}/api/w/{token}/stream', stream=True, timeout=(70, 90)) as r:
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
                                self.fire_hotkeys(data.get('amount', 0))
                                self.push('donation', data)
                            elif event == 'settings':
                                self.hotkeys = data.get('hotkeys', []) or []
                            event = None
            except Exception:
                time.sleep(3)

    def fire_hotkeys(self, amount):
        for h in self.hotkeys:
            lo, hi = h.get('min', 0), h.get('max', 0)
            if amount >= lo and (not hi or amount <= hi) and keyboard:
                try:
                    keyboard.send(h['keys'])
                    self.log(f'⌨ Хоткей {h["keys"]} ({amount} ₸)')
                except Exception as e:
                    self.log(f'Хоткей {h.get("keys")}: {e}')


def resource(name):
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def main():
    api = Api()
    with open(resource('ui.html'), encoding='utf-8') as f:
        html = f.read()
    window = webview.create_window(f'{APP_NAME}', html=html, js_api=api, width=440, height=760,
                                   min_size=(400, 600), background_color='#07080D', minimized='--minimized' in sys.argv)
    api.window = window

    def on_ready():
        if api.cfg.get('token'):
            api.start()
    webview.start(on_ready, private_mode=False)
    api.running = False


if __name__ == '__main__':
    main()
